// node --test --test-isolation=none scripts/transaction-graph.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import { analyze, loadSources, violations } from './check-transaction-graph.mjs'
import { blank, callsIn, transactionRoots, useAliases } from './transaction-graph-lib.mjs'

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
    pub async fn sea_op(tx: &WriteTx) -> Result<(), DbErr> { Ok(()) }
    pub async fn sea_read(reader: &impl Read) -> Result<(), DbErr> { Ok(()) }`,
}

function problemsFor(extra) {
  const files = { ...BASE, ...extra }
  const read = (p) => files[p] ?? null
  const list = (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`))
  return violations(analyze(loadSources(read, list)))
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
  assert.match(problems[0], /^R1 .*SeaORM 函数 .*sea_op/)
})

test('a SeaORM transaction calling a Diesel op is R1', () => {
  const problems = problemsFor({
    [`${SHELL}/commands/x.rs`]: `
      async fn run(db: &Db, conn: &mut SqliteConnection) -> Result<(), DbErr> {
          db.write(async |tx| { meridian_core::db::ops::queue::enqueue_in_transaction(conn); Ok(()) }).await
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^R1 .*Diesel 函数 .*enqueue_in_transaction/)
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
