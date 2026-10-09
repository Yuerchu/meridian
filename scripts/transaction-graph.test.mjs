// node --test --test-isolation=none scripts/transaction-graph.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyze,
  baselineProblems,
  dualImplProblems,
  dualImplementations,
  loadSources,
  parsePendingTables,
  uncheckedReceivers,
  violations,
} from './check-transaction-graph.mjs'
import {
  blank,
  callsIn,
  normalizeReceiver,
  receiverBefore,
  transactionRoots,
  useAliases,
} from './transaction-graph-lib.mjs'

const CORE = 'src-tauri/crates/core/src'
const SHELL = 'src-tauri/src'

/** 两个现成的被调用方：一个 Diesel op（自带 IMMEDIATE），一个 SeaORM op。 */
const BASE = {
  [`${CORE}/lib.rs`]: 'pub mod db;',
  [`${CORE}/db/ops/queue.rs`]: `
    pub fn enqueue(conn: &mut SqliteConnection) -> QueryResult<()> {
        conn.immediate_transaction(|conn| enqueue_in_transaction(conn))
    }
    pub fn enqueue_in_transaction(conn: &mut SqliteConnection) -> QueryResult<()> {
        diesel::insert_into(queued_prompts::table).execute(conn).map(|_| ())
    }`,
  [`${CORE}/db/sea/ops.rs`]: `
    use crate::db::sea::cap::Read;
    pub async fn sea_op(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
    pub async fn sea_read(reader: &impl Read) -> Result<(), DbErr> { Ok(()) }`,
}

function graphFor(extra) {
  const files = { ...BASE, ...extra }
  const read = (p) => files[p] ?? null
  const list = (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`))
  return analyze(loadSources(read, list))
}

function problemsFor(extra) {
  return violations(graphFor(extra))
}

test('a Diesel transaction calling a SeaORM op is R1', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      fn guard(conn: &mut SqliteConnection, tx: &WriteTx) -> QueryResult<()> {
          conn.immediate_transaction(|conn| { ops::sea_op(tx); Ok(()) })
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*SeaORM：.*sea_op/)
})

test('a SeaORM transaction calling a Diesel op is R1', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      async fn run(db: &Db, conn: &mut SqliteConnection) -> Result<(), DbErr> {
          db.write(async |tx| { meridian_core::db::ops::queue::enqueue_in_transaction(conn); Ok(()) }).await
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*Diesel：.*enqueue_in_transaction/)
})

test('going back to the Db a transaction came from is R2', () => {
  for (const [receiver, inner] of [
    ['db', 'sea_read(&db)'],
    ['self.db', 'sea_read(&self.db)'],
    ['services.sea', 'sea_read(&services.sea)'],
  ]) {
    const problems = problemsFor({
      [`${SHELL}/commands/x.rs`]: `
        use meridian_core::db::sea::ops::sea_read;
        async fn run() -> Result<(), DbErr> {
            ${receiver}.write(async |tx| { ${inner}.await?; Ok(()) }).await
        }`,
    })
    assert.equal(problems.length, 1, receiver)
    assert.match(problems[0], /^R2 /)
  }
})

test('using the transaction itself is not R2', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops::{sea_op, sea_read};
      async fn run(db: &Db) -> Result<(), DbErr> {
          db.write(async |tx| { sea_read(tx).await?; sea_op(tx).await }).await
      }`,
  })
  assert.deepEqual(problems, [])
})

test('an IMMEDIATE op reached from inside a Diesel transaction is R3', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/queue.rs`]: `
      use meridian_core::db::ops::queue as ops;
      fn enqueue_unless_plan_barrier(conn: &mut SqliteConnection) -> QueryResult<()> {
          conn.immediate_transaction(|conn| ops::enqueue(conn))
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R3 .*queue\.rs:4.*enqueue/)
})

test('the _in_transaction variant inside a Diesel transaction is fine', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/queue.rs`]: `
      use meridian_core::db::ops::queue as ops;
      fn enqueue_unless_plan_barrier(conn: &mut SqliteConnection) -> QueryResult<()> {
          conn.immediate_transaction(|conn| ops::enqueue_in_transaction(conn))
      }`,
  })
  assert.deepEqual(problems, [])
})

test('a closure handed to a transaction-opening helper counts toward that transaction', () => {
  const helper = {
    [`${SHELL}/commands/conversation.rs`]: `
      fn mutation<F>(conn: &mut SqliteConnection, f: F) -> QueryResult<()>
      where
          F: FnOnce(&mut SqliteConnection) -> QueryResult<()>,
      {
          conn.immediate_transaction(|conn| f(conn))
      }`,
  }
  const viaSea = problemsFor({
    ...helper,
    [`${SHELL}/commands/assistant.rs`]: `
      use super::conversation::mutation;
      fn rename(conn: &mut SqliteConnection, tx: &WriteTx) -> QueryResult<()> {
          mutation(conn, |c| { meridian_core::db::sea::ops::sea_op(tx); Ok(()) })
      }`,
  })
  assert.equal(viaSea.length, 1)
  assert.match(viaSea[0], /^R1 .*sea_op/)

  const viaImmediate = problemsFor({
    ...helper,
    [`${SHELL}/commands/assistant.rs`]: `
      use super::conversation::mutation;
      fn requeue(conn: &mut SqliteConnection) -> QueryResult<()> {
          mutation(conn, |c| meridian_core::db::ops::queue::enqueue(c))
      }`,
  })
  assert.equal(viaImmediate.length, 1)
  assert.match(viaImmediate[0], /^R3 /)
})

test('transactions inside test code are not checked', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      #[cfg(test)]
      mod tests {
          fn t(conn: &mut SqliteConnection) {
              conn.immediate_transaction(|conn| meridian_core::db::ops::queue::enqueue(conn)).unwrap();
          }
      }`,
  })
  assert.deepEqual(problems, [])
})

test('blank keeps offsets and hides strings, raw strings, chars and comments', () => {
  const source = 'let s = r#"a { "( b"#; let c = \'{\'; let l: &\'a str = "x)"; // f(\n/* g( */ h();'
  const text = blank(source)
  assert.equal(text.length, source.length)
  assert.equal(text.includes('{'), false)
  assert.equal(text.includes("&'a str"), true, 'a lifetime is not a char literal')
  assert.deepEqual(
    callsIn(text, [0, text.length]).map((c) => c.name),
    ['h'],
  )
})

test('use trees expand to every alias', () => {
  const aliases = useAliases(blank('use crate::db::{ops::queue as q, ops::{turn, conversation::{self}}, sea::cap::*};'))
  assert.equal(aliases.get('q'), 'crate::db::ops::queue')
  assert.equal(aliases.get('turn'), 'crate::db::ops::turn')
  assert.equal(aliases.get('conversation'), 'crate::db::ops::conversation')
  assert.equal(aliases.has('*'), false)
})

test('io writes and lock reads are not transaction roots', () => {
  const text = blank('file.write(&bytes)?; let g = lock.read().await; db.write(async |tx| op(tx).await);')
  assert.deepEqual(
    transactionRoots(text).map((r) => r.kind),
    ['sea-write'],
  )
})

// ── Codex review on #87 ──────────────────────────────────────────────────────

test('the other ORM written directly inside a closure is R1', () => {
  const inDiesel = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      fn f(conn: &mut SqliteConnection) -> QueryResult<()> {
          conn.immediate_transaction(|conn| { sea_orm::EntityTrait::find(); Ok(()) })
      }`,
  })
  assert.equal(inDiesel.length, 1)
  assert.match(inDiesel[0], /^R1 .*SeaORM/)

  const inSea = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      async fn f(db: &Db, conn: &mut SqliteConnection) -> Result<(), DbErr> {
          db.write(async |tx| { diesel::insert_into(t::table).execute(conn); Ok(()) }).await
      }`,
  })
  assert.equal(inSea.length, 1)
  assert.match(inSea[0], /^R1 .*Diesel/)
})

test('a name containing "as" is an import, not an alias', () => {
  const aliases = useAliases(
    blank('use crate::db::ops::assistant; use crate::tasks::{last, base as basis}; use a::b::classify as cast;'),
  )
  assert.equal(aliases.get('assistant'), 'crate::db::ops::assistant')
  assert.equal(aliases.get('last'), 'crate::tasks::last')
  assert.equal(aliases.get('basis'), 'crate::tasks::base')
  assert.equal(aliases.get('cast'), 'a::b::classify')
  assert.equal(aliases.has('sistant'), false)
})

test('an import whose name contains "as" still leads to its ops module', () => {
  const graph = graphFor({
    [`${CORE}/db/ops/assistant.rs`]: `
      pub fn rename_in_transaction(conn: &mut SqliteConnection) -> QueryResult<()> {
          diesel::update(assistants::table).execute(conn).map(|_| ())
      }`,
    [`${SHELL}/commands/assistant.rs`]: `
      use meridian_core::db::ops::assistant;
      fn rename(conn: &mut SqliteConnection) -> QueryResult<()> {
          conn.immediate_transaction(|conn| assistant::rename_in_transaction(conn))
      }`,
  })
  assert.deepEqual(graph.roots.find((r) => r.file.path.endsWith('commands/assistant.rs')).modules, ['assistant'])
})

test('a receiver written another way is still the same handle', () => {
  for (const [expr, handle] of [
    ['db.clone()', 'db'],
    ['(&db)', 'db'],
    ['&self.db', 'self.db'],
    ['app.services().sea', 'app.services().sea'],
  ]) {
    const text = blank(`let r = ${expr}.write(async |tx| op(tx).await);`)
    assert.equal(normalizeReceiver(receiverBefore(text, text.indexOf('.write'))), handle, expr)
  }
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops::sea_read;
      async fn f(db: &Db) -> Result<(), DbErr> {
          db.clone().write(async |tx| { sea_read(&db).await }).await
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R2 /)
})

test('a receiver that is a call cannot be checked, and says so', () => {
  const graph = graphFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops::sea_read;
      async fn f() -> Result<(), DbErr> {
          get_db().write(async |tx| { sea_read(tx).await }).await
      }`,
  })
  assert.deepEqual(violations(graph), [])
  assert.deepEqual(uncheckedReceivers(graph), ['src-tauri/src/commands/x.rs:4'])
})

test('a closure parameter named like the receiver is the parameter', () => {
  const shadowed = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops::sea_op;
      async fn f(tx: &WriteTx) -> Result<(), DbErr> {
          tx.nested(async |tx| { sea_op(tx).await }).await
      }`,
  })
  assert.deepEqual(shadowed, [])

  const outer = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops::sea_op;
      async fn f(tx: &WriteTx) -> Result<(), DbErr> {
          tx.nested(async |inner| { sea_op(tx).await }).await
      }`,
  })
  assert.equal(outer.length, 1)
  assert.match(outer[0], /^R2 /)
})

test('a test-only caller of a transaction helper does not taint the production root', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/conversation.rs`]: `
      pub fn mutation<F>(conn: &mut SqliteConnection, f: F) -> QueryResult<()>
      where
          F: FnOnce(&mut SqliteConnection) -> QueryResult<()>,
      {
          conn.immediate_transaction(|conn| f(conn))
      }

      #[cfg(test)]
      mod tests {
          use super::mutation;
          fn t(conn: &mut SqliteConnection) {
              mutation(conn, |c| meridian_core::db::ops::queue::enqueue(c)).unwrap();
          }
      }`,
  })
  assert.deepEqual(problems, [])
})

// ── Codex review on #87, second round ────────────────────────────────────────

test('an ORM function imported by use and called bare is still that ORM', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use diesel::insert_into;
      async fn f(db: &Db) -> Result<(), DbErr> {
          db.write(async |tx| { insert_into(t); Ok(()) }).await
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*Diesel/)
})

test('a callback argument calling the other ORM directly is R1', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/conversation.rs`]: `
      pub fn mutation<F>(conn: &mut SqliteConnection, f: F) -> QueryResult<()>
      where
          F: FnOnce(&mut SqliteConnection) -> QueryResult<()>,
      {
          conn.immediate_transaction(|conn| f(conn))
      }`,
    [`${SHELL}/commands/assistant.rs`]: `
      use super::conversation::mutation;
      fn g(conn: &mut SqliteConnection) -> QueryResult<()> {
          mutation(conn, |c| { sea_orm::EntityTrait::find(); Ok(()) })
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*SeaORM/)
})

test('a use inside a test module does not rewrite the production alias', () => {
  const problems = problemsFor({
    [`${CORE}/unrelated.rs`]: 'pub fn enqueue() {}',
    [`${SHELL}/commands/queue.rs`]: `
      use meridian_core::db::ops::queue as ops;
      fn g(conn: &mut SqliteConnection) -> QueryResult<()> {
          conn.immediate_transaction(|conn| ops::enqueue(conn))
      }

      #[cfg(test)]
      mod tests {
          use meridian_core::unrelated as ops;
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R3 /)
})

test('a function gated by cfg(test) or #[test] is test code', () => {
  for (const attr of ['#[cfg(test)]', '#[test]', '#[tokio::test(flavor = "multi_thread")]']) {
    const problems = problemsFor({
      [`${SHELL}/commands/conversation.rs`]: `
        pub fn mutation<F>(conn: &mut SqliteConnection, f: F) -> QueryResult<()>
        where
            F: FnOnce(&mut SqliteConnection) -> QueryResult<()>,
        {
            conn.immediate_transaction(|conn| f(conn))
        }

        ${attr}
        fn helper(conn: &mut SqliteConnection) {
            mutation(conn, |c| meridian_core::db::ops::queue::enqueue(c)).unwrap();
        }`,
    })
    assert.deepEqual(problems, [], attr)
  }
})

test('a Diesel transaction handed a named closure is R0', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/queue.rs`]: `
      fn g(conn: &mut SqliteConnection) -> QueryResult<()> {
          let op = |conn: &mut SqliteConnection| meridian_core::db::ops::queue::enqueue(conn);
          conn.immediate_transaction(op)
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R0 /)
})

test('the baseline has to follow every decrease', () => {
  const path = 'docs/migration-counters.json'
  assert.deepEqual(baselineProblems({ a: 10 }, { a: 10 }, path), [])
  assert.match(baselineProblems({ a: 11 }, { a: 10 }, path)[0], /涨到 11/)
  assert.match(baselineProblems({ a: 8 }, { a: 10 }, path)[0], /更新为 8/)
  assert.match(baselineProblems({ a: 8 }, {}, path)[0], /缺少计数 a/)
})

test('std::io::Read is not the capability Read', () => {
  const ioHelper = `
    fn g(conn: &mut SqliteConnection, r: &mut std::fs::File) -> QueryResult<()> {
        conn.immediate_transaction(|conn| { digest(r); Ok(()) })
    }`
  for (const head of [
    'use std::io::Read;\nfn digest(reader: &mut impl Read) -> u64 { 0 }',
    'fn digest(reader: &mut impl std::io::Read) -> u64 { 0 }',
  ]) {
    assert.deepEqual(problemsFor({ [`${SHELL}/commands/h.rs`]: head + ioHelper }), [], head)
  }
  const capability = problemsFor({
    [`${SHELL}/commands/h.rs`]:
      'use meridian_core::db::sea::cap::Read;\nfn digest(reader: &impl Read) -> u64 { 0 }' + ioHelper,
  })
  assert.equal(capability.length, 1)
  assert.match(capability[0], /^R1 /)
})

test('the innermost use wins, wherever the outer one is written', () => {
  const problems = problemsFor({
    [`${CORE}/unrelated.rs`]: 'pub fn enqueue() {}',
    [`${SHELL}/commands/queue.rs`]: `
      fn g(conn: &mut SqliteConnection) -> QueryResult<()> {
          use meridian_core::db::ops::queue as ops;
          conn.immediate_transaction(|conn| ops::enqueue(conn))
      }

      use meridian_core::unrelated as ops;`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R3 /)
})

test('a Diesel connection named only by its type inside a SeaORM closure is R1', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      async fn f(db: &Db, pool: &Pool) -> Result<(), DbErr> {
          db.write(async |tx| {
              let conn: &mut SqliteConnection = &mut pool.get()?;
              conn.batch_execute("DELETE FROM t")?;
              Ok(())
          }).await
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*Diesel/)
})

// ── Phase 2c：待迁移的表与双实现登记 ─────────────────────────────────────────

test('pendingTables is a set that only shrinks and only holds known names', () => {
  const path = 'docs/migration-counters.json'
  const baseline = { pendingTables: ['a', 'b', 'c'] }
  assert.deepEqual(baselineProblems({ pendingTables: ['a', 'b', 'c'] }, baseline, path), [])
  assert.match(
    baselineProblems({ pendingTables: ['a', 'c'] }, baseline, path)[0],
    /从 3 降到 2（b 有 entity 了）：把 .*更新为当前列表/,
  )
  const stranger = baselineProblems({ pendingTables: ['a', 'b', 'c', 'zz_new'] }, baseline, path)
  assert.equal(stranger.length, 1)
  assert.match(stranger[0], /`zz_new` 不在基线里：共存期新建的表必须带 entity，不得进 PENDING_TABLES/)
  // A stranger beside a removal is reported as the stranger only: updating the
  // baseline to "the current list" would smuggle the new name in.
  const both = baselineProblems({ pendingTables: ['a', 'zz_new'] }, baseline, path)
  assert.equal(both.length, 1)
  assert.match(both[0], /zz_new/)
  assert.match(baselineProblems({ pendingTables: ['a'] }, { pendingTables: 1 }, path)[0], /必须是数组/)
  assert.match(baselineProblems({ pendingTables: ['a'] }, {}, path)[0], /缺少计数 pendingTables/)
})

test('PENDING_TABLES is parsed exactly, and anything else is a hard error', () => {
  const wrap = (body) => `/// doc\npub const PENDING_TABLES: &[&str] = &[\n${body}];\n`
  assert.deepEqual(parsePendingTables(wrap('    "a",\n    "b",\n')), ['a', 'b'])
  assert.deepEqual(parsePendingTables(wrap('')), [])
  assert.throws(() => parsePendingTables(wrap('    "b",\n    "a",\n')), /必须排序且不重复：b 后面是 a/)
  assert.throws(() => parsePendingTables(wrap('    "a",\n    "a",\n')), /必须排序且不重复/)
  assert.throws(() => parsePendingTables(wrap('    "a", "b",\n')), /每一项必须是/)
  assert.throws(() => parsePendingTables('pub const OTHER: &[&str] = &[];'), /找不到/)
})

const DIESEL_TWIN = {
  [`${CORE}/db/ops/conversation.rs`]: `
    pub fn rename(conn: &mut SqliteConnection) -> QueryResult<()> {
        diesel::update(conversations::table).execute(conn).map(|_| ())
    }
    pub fn archive(conn: &mut SqliteConnection) -> QueryResult<()> {
        diesel::update(conversations::table).execute(conn).map(|_| ())
    }`,
}

test('a sea op with a same-named Diesel op is a pair, counted by the Diesel callers left', () => {
  const graph = graphFor({
    ...DIESEL_TWIN,
    [`${CORE}/db/sea/ops/conversation.rs`]: `
      pub async fn rename(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
      pub async fn archive(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
      pub async fn pin(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
      fn helper(tx: &WriteTx) {}`,
    [`${SHELL}/commands/conversation.rs`]: `
      use meridian_core::db::ops::conversation as ops;
      fn a(conn: &mut SqliteConnection) -> QueryResult<()> { ops::rename(conn) }
      fn b(conn: &mut SqliteConnection) -> QueryResult<()> { ops::rename(conn) }`,
  })
  const pairs = dualImplementations(graph)
  // `pin` has no Diesel twin and `helper` is not pub: neither is a pair.
  assert.deepEqual(pairs, [
    { module: 'conversation', name: 'archive', remaining: 0 },
    { module: 'conversation', name: 'rename', remaining: 2 },
  ])

  const doc =
    '# 双实现登记\n\n| 操作 | 剩余 Diesel 调用点 |\n|---|---|\n| conversation::rename | 2 |\n| conversation::archive | 0 |\n'
  const problems = dualImplProblems(pairs, doc)
  assert.equal(problems.length, 1)
  assert.match(
    problems[0],
    /conversation::archive 的 Diesel 版本已经没有调用点：删掉 db\/ops\/conversation\.rs 里的 archive/,
  )

  const renameOnly = pairs.filter((p) => p.name === 'rename')
  assert.deepEqual(dualImplProblems(renameOnly, doc.replace('| conversation::archive | 0 |\n', '')), [])
  assert.match(
    dualImplProblems(renameOnly, doc.replace('| conversation::archive | 0 |\n', '').replace('| 2 |', '| 1 |'))[0],
    /写的是 1，实际 2/,
  )
  assert.match(
    dualImplProblems(renameOnly, '| 操作 | 剩余 Diesel 调用点 |\n|---|---|\n')[0],
    /缺少 conversation::rename（剩余 Diesel 调用点 2）/,
  )
  assert.match(dualImplProblems([], doc.replace('| conversation::archive | 0 |\n', ''))[0], /多出 conversation::rename/)
  assert.match(dualImplProblems([], null)[0], /不存在/)
})

test('a sea op under another name is not a pair, by design', () => {
  const graph = graphFor({
    ...DIESEL_TWIN,
    [`${CORE}/db/sea/ops/conversation.rs`]:
      'pub async fn rename_conversation(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }',
  })
  assert.deepEqual(dualImplementations(graph), [])
})

test('a Diesel helper nothing outside db/ops can name is not a pair', () => {
  const graph = graphFor({
    ...BASE,
    [`${CORE}/db/ops/todo.rs`]: `
      fn get_active_list(conn: &mut SqliteConnection) -> QueryResult<()> { Ok(()) }
      pub(super) fn complete(conn: &mut SqliteConnection) -> QueryResult<()> { Ok(()) }
      pub(crate) fn render(conn: &mut SqliteConnection) -> QueryResult<()> { Ok(()) }
      pub fn get_active_view(conn: &mut SqliteConnection) -> QueryResult<()> { get_active_list(conn) }`,
    [`${CORE}/db/sea/ops/todo.rs`]: `
      pub async fn get_active_list(db: &impl Read) -> Result<(), DbErr> { Ok(()) }
      pub async fn complete(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
      pub fn render(view: &View) -> Option<String> { None }
      pub async fn get_active_view(db: &impl Read) -> Result<(), DbErr> { Ok(()) }`,
    [`${CORE}/agent/x.rs`]: `
      fn freeze(conn: &mut SqliteConnection) {
          let _ = crate::db::ops::todo::get_active_view(conn).ok().and_then(crate::db::ops::todo::render);
      }`,
  })
  assert.deepEqual(dualImplementations(graph), [
    { module: 'todo', name: 'get_active_view', remaining: 1 },
    { module: 'todo', name: 'render', remaining: 1 },
  ])
})

test('a pool read before a write transaction in the same function is R5', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      async fn add(services: &Services) -> Result<(), DbErr> {
          let full = ops::sea_read(&services.sea).await?;
          services.sea.write(async |tx| ops::sea_op(tx).await).await
      }`,
  })
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^R5 .*x\.rs:4: sea_read\(services\.sea\)/)
})

test('the same read inside the write, a justified one, and test code are not R5', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      async fn inside(services: &Services) -> Result<(), DbErr> {
          services.sea.write(async |tx| { ops::sea_read(tx).await?; ops::sea_op(tx).await }).await
      }
      async fn after(services: &Services) -> Result<(), DbErr> {
          services.sea.write(async |tx| ops::sea_op(tx).await).await?;
          ops::sea_read(&services.sea).await
      }
      async fn justified(db: &Db) -> Result<(), DbErr> {
          // pool-read-before-write: startup, nothing else writes yet.
          ops::sea_read(db).await?;
          db.write(async |tx| ops::sea_op(tx).await).await
      }
      #[cfg(test)]
      mod tests {
          async fn seeded(db: &Db) {
              ops::sea_read(db).await.unwrap();
              db.write(async |tx| ops::sea_op(tx).await).await.unwrap();
          }
      }`,
  })
  assert.deepEqual(problems, [])
})

test('a justification covers the read right after it, not every read in the function', () => {
  // 2026-10-08: a marker written for the conversation-id read in
  // update_provider also excused a provider read added later in the same
  // function, three lines above its write; the checker stayed green.
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      async fn update(services: &Services) -> Result<(), DbErr> {
          // pool-read-before-write: these ids only pick the leases; the write re-reads them.
          let ids = ops::sea_read(&services.sea).await?;
          take_leases(&ids);

          let current = ops::sea_read(&services.sea).await?;
          services.sea.write(async |tx| ops::sea_op(tx).await).await
      }`,
  })
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^R5 .*x\.rs:8: sea_read\(services\.sea\)/)
})

test('a chain rustfmt broke across lines is still the same receiver', () => {
  const [root] = transactionRoots(
    blank(`fn f() { services\n        .sea\n        .write(async |tx| ops::sea_op(tx).await) }`),
  )
  assert.equal(root.receiver, 'services.sea')
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      async fn add(services: &Services) -> Result<(), DbErr> {
          ops::sea_read(&services.sea).await?;
          services
              .sea
              .write(async |tx| ops::sea_op(tx).await)
              .await
      }`,
  })
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^R5 /)
})

test('handing the pool to something that is not a read op is not R5', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      use meridian_core::db::sea::ops;
      async fn reindex(db: &Db) -> Result<(), DbErr> { db.write(async |tx| ops::sea_op(tx).await).await }
      async fn add(services: &Services) -> Result<(), DbErr> {
          reindex(&services.sea).await?;
          services.sea.write(async |tx| ops::sea_op(tx).await).await
      }`,
  })
  assert.deepEqual(problems, [])
})
