---
paths:
  - "src-tauri/ime/**"
  - "src-tauri/src/ime/**"
  - "src/components/settings/ime-*.tsx"
---

# The input method

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

## The input method

`src-tauri/ime/` is a Windows input method — pinyin and zhuyin, plus the grid
layout the phone keyboard types — that installs with Meridian and does not
need it running. It is in the shell workspace and not in core because a
headless server and `meridiand` must not carry one, and it is ten crates
rather than one because the boundaries are the design.

- **The DLL holds no engine, reads no file and computes no path.** A text
  service is loaded into every process with a text field, including store
  apps in an AppContainer that cannot see `%APPDATA%`, and a panic in it is a
  crash in Word. So `meridian-ime-tsf` forwards keys over a named pipe, applies
  the answers to the document, and nothing else; settings it must know before
  the first key (`page_size`, punctuation, the scheme) arrive in `Welcome`.
  Every COM entry point is under `catch_unwind` and a key whose handling
  panicked is passed through. The crate boundary is what enforces it: the DLL
  depends on `meridian-ime-proto` alone.
- **One host per login session, one `Session` per text field.** The pipe is
  `\\.\pipe\meridian-ime-s<session id>`, so a remote-desktop session and a
  fast-switched second user each get their own host, and the first instance is
  created with `FILE_FLAG_FIRST_PIPE_INSTANCE` so the kernel, not a mutex,
  refuses a second host. Its ACL names the user, `ALL APPLICATION PACKAGES` and
  `ALL RESTRICTED APPLICATION PACKAGES` with a low mandatory label, which is
  exactly the set that has to reach it: an AppContainer's access check needs
  the user *and* the package SID, a browser renderer is at low integrity, and
  the prototype's `Everyone` was not a boundary. The DLL starts the host when
  the pipe is absent — from a medium-integrity process only, behind a named
  mutex and a cooldown — and while it is absent letters go into the document
  as typed rather than vanishing.
- **Edit sessions are asynchronous, always.** `TF_ES_SYNC` inside the key sink
  is documented as allowed and measured (by qingjian) to crash applications
  whose text store lives in another process, which is the current Notepad. So
  `OnKeyDown` updates the local "are we composing" view from the host's reply
  and then requests the session; the document catches up a moment later on the
  same thread, and `OnTestKeyDown` never contradicts it. A key the DLL promised
  to eat and the host then declined is inserted by the DLL itself, because some
  applications drop a key that was declared eaten and then was not.
- **Privacy is two gates, and neither is a filter.** The DLL reads
  `GUID_COMPARTMENT_KEYBOARD_DISABLED` per key and the input scope
  (`IS_PASSWORD`, `IS_PRIVATE`, the PIN scopes) per focus change, and the host
  wraps the learner in `Muted` for that session: reads unchanged, writes
  swallowed, no flag anywhere that a write path could forget to check.
  `private_apps` in `host.json` is the same wrapper keyed on the executable.
  Nothing an input method sees reaches Meridian's memory yet; when it does, it
  goes through `services.redaction` first and lands as `UserProvidedContext`.
- **Dictionaries are imported, not shipped.** A Rime `.dict.yaml` (rime-ice is
  the one to start with) is converted by `meridian-ime-dict::rime` into an
  `.mdict` — one memory-mapped file whose layout is its in-memory layout, with a
  `META` section carrying the source's own SPDX licence — and cached by a hash
  over every file it imported plus the format, importer and syllable-table
  versions. The importer reads the YAML header's `columns` rather than
  assuming them: rime-ice's `tencent` table is `text weight` with no code, and
  the prototype, assuming `text code weight`, filed half its dictionary under
  the code `100`. Codes are validated against the syllable table; an ASCII-only
  text (`A A`, the capital-letter rows) is refused rather than filed under `a`.
  An `import_tables` name is the file's own say and is kept inside the
  dictionary's directory — no `..`, no absolute path, and the canonical path
  checked again for a link pointing out — because an archive's header would
  otherwise reach past what was unpacked (`FileSkip::OutsideRoot`).
  `POST.entry_count` is 32 bits because the prototype packed 16 into the FST
  value and overflowed it, and the test that writes seventy thousand entries
  under one code is what keeps it that way.
- **Three schemes, one lattice.** Pinyin, zhuyin and grid are `SchemeParser`s that
  turn keys into the same syllable DAG — an edge is a canonical pinyin
  syllable, `complete` or the start of one — so the dictionary, the lattice,
  the beam search and the learner never know which keyboard was used. A bare
  initial anywhere and an unfinished syllable at the end are edges too, which
  is what puts candidates on screen from the first key. Under zhuyin the tone
  keys are boundaries and the tone value is ignored, since the dictionaries are
  toneless; digits are bopomofo keys there, so candidates are chosen with
  Up/Down and Enter, and Space after a toneless syllable is the first tone.
- **The grid is fuzzy by design, and its fuzziness is data.** Nine columns of
  pinyin-lettered keys with zhuyin's structure: `z` `c` `s` each stand for
  both the dental and the retroflex initial, `ng` is the only nasal key, and
  tones are optional keys (ˉ ˊ ˇ ˋ ˙) that close a syllable when typed. A
  syllable's keys come from its bopomofo spelling through two tables,
  `grid_initials.txt` and `grid_rimes.txt`, and every syllable a key sequence
  can mean is its own edge from the same start to the same end — so `z w ng`
  is zhong, zong, zhun and zun at once, with no change to the dictionary.
  `shared_spellings_are_only_the_designed_merges` is the gate on those tables:
  syllables may share a spelling only if they are equal once retroflex folds
  to dental, ㄤ to ㄢ and ㄥ to ㄣ, so an edit that merges more fails. One key
  is one `char` — the multi-letter keys are private-use code points, the tone
  keys are the tone marks — so the key string, `Candidate::consumed` and
  Backspace keep counting characters, and the preedit shows labels, never a
  private-use character. Space only commits (the first tone has its own key)
  and digits select. **A long press is the precise key**: `z` offers `z_`/`zh`,
  `c` and `s` likewise, `ng` offers `er`/`-n`/`-ng`, each spelling exactly one
  of what the tap covers (which also separates dun/dong and jun/jiong, merged
  as a side effect of the single nasal key). `GridToken::variants` is the
  menu, so the keyboard reads it rather than keeping its own list. A precise
  key is only precise if its *unfinished* edges are too: they are looked up
  by prefix, and `z` as a prefix is also every `zh…`, so `cover` splits a
  prefix by its next letter until it reaches nothing the keys exclude.
  **Both spelling habits are accepted at once.** A pinyin typist drops the
  `e` of ㄣ/ㄥ after a medial (dun `d w ng`), a zhuyin typist keeps it
  (ㄉㄨㄣ `d w e ng`); the zhuyin spelling is an alternative marked
  `zhuyin:` in `grid_rimes.txt`, so there is no setting, and `SpellingHabit`
  only picks which one `keys_for_habit` / `bench --habit` types. In the
  zhuyin habit jun and jiong share `j v e ng` on a tap, accepted because
  jiong's characters are rare; a long press on the nasal separates them. `Scheme::Grid` on the wire is why `PROTOCOL_VERSION` is
  2: the wire enum has no catch-all, so an older DLL fails the `Welcome`
  rather than silently typing pinyin. `grid_table_sha256()` is what a model
  trained on the layout is checked against.
- **`keys_for` turns toned pinyin into any scheme's keys.** The evaluation set
  stores what a sentence says (`ni3 hao3`), not what was typed, so one set
  scores every scheme and every tone habit (`TonePolicy`). `meridian-ime keys`
  prints the same strings for the training repository to compare byte for
  byte; `bench --eval` reports top-1, keystrokes per character and cache
  misses per keystroke. Measured on rime-ice, 2026-09, toneless: pinyin 3.27
  KPC, zhuyin 2.48, grid 2.74 (2.87 in the zhuyin habit); grid's worst
  keystroke 6–8 ms against a 30 ms budget, which is why pruning dead lattice
  paths is not built.
- **The language model scores candidates; it never chooses them.**
  `meridian-ime-lm` implements `SentenceScorer` over ONNX Runtime opened at
  run time (`load-dynamic`, API 17): the host finds the copy sherpa-onnx
  already installs in `$INSTDIR`, `MERIDIAN_ORT_LIB` overrides. It is asked
  once per query about the beam's readings *and* the best whole-input words
  — without the second, 你/尼/泥 for one syllable could never be reordered —
  with the text around the cursor (`ScoreRequest.left/right`, from the app or
  from what the session committed) and, where allowed, memory hints. Three
  things keep it from costing a keystroke: a budget from the manifest after
  which the run is terminated and the answer is "no opinion", a breaker that
  stops asking for two seconds after five misses, and a cache per context.
  The score is mixed in as `RERANK_MIX · (lm − static)` after the manifest's
  `scale` puts it on the dictionary's footing. A scheme the bundle does not
  list in `manifest.schemes` (and have a key table for) gets no opinion: its
  keys would reach the model as unknowns and come back as scores that mean
  nothing. A private session tells it
  nothing — no left, no right, no hints — and keeps no context to tell later.
- **A model bundle is refused, not tolerated.** `<ime>/models/<id>/` holds
  `score.onnx`, `vocab.json` and a `manifest.json` with `deny_unknown_fields`
  whose file hashes, grid table hash and syllable table hash must all match
  this build; the graph's contract is in `lm/src/backend.rs`. A personal
  bundle (`personal: true`, trained on the person's own exported typing) is
  preferred and never published; the public one is static. The host reloads
  when a manifest appears or changes; the settings page installs from a
  directory and removes manifest-first so the host lets go before the files
  go. An install is copied into `.name.tmp-<pid>` and renamed into place, so a
  dot-named directory is never a bundle to `choose`, and Meridian sweeps
  those a crash left at start. The tests generate a contract graph as protobuf by hand, so they need
  neither a checked-in binary nor Python, and run against the real runtime
  when `resources/onnxruntime.dll` or `MERIDIAN_ORT_LIB` is there.
- **Memory hints flow from Meridian to the input method, never back.**
  `src/ime/hints.rs` writes `<ime>/context/memory-hints.json` every minute
  when it would change: client-global memories only, cut into 2–32 character
  mostly-Chinese phrases, a memory any redaction rule touches dropped whole,
  no id, scope, person or time. It is recomputed rather than hooked because
  the agent saves memories inside core where the shell never sees it. The
  host hands them only to sessions in `meridian.exe` or an app listed in
  `context_apps`, never to a private one; without a model they still lift a
  whole-input word of two or more characters that a hint contains
  (`CONTEXT_BONUS`).
- **Prediction is a list on the side, not a mode.** After a commit of
  Chinese words the session offers what may follow (`Engine::predict`, then
  ，and 。): first what the personal n-gram has seen after the last word
  (`UserNgram::followers`, at least `MIN_PERSONAL_COUNT`), then the rest of
  the dictionary words it begins — after 中国, 人 and 队 from 中国人 and 中国队 —
  which `.mdict` format 2 indexes for this (`PRFX`/`PRPO`/`PRID`, keyed by a
  text that is itself a word, capped at `CONTINUATION_CAP`). The list answers
  four bare keys and nothing else: Up and Down move, Tab takes, Esc closes;
  every other key closes it and then means what it always means, which is
  what leaves letters and digits alone. On Windows a key the DLL does not eat
  never reaches the host, so the DLL sends `Dismiss` for it, and for a caret
  moved by the mouse (`ITfTextEditSink`, skipping the echo of its own edit
  sessions) — `PROTOCOL_VERSION` 3, since an older DLL would neither eat the
  four keys nor ever close the list. Android sends `nativeDismiss` from
  `onUpdateSelection` once the commit's own echo has been seen. A dismissal
  from outside also ends the commit chain (the next word is not written
  after the last one); Esc and typing on do not. A private session is offered
  the dictionary alone, without the person's n-gram or user words, because
  the list is drawn on screen.
- **A dictionary from an older build is upgraded in place, not imported
  again.** A `.mdict` holds every (code, text, frequency) it was built from
  and everything else in it is derived, so `upgrade_in_place` is the old
  format's reader (`format/legacy.rs`, one module per version, carrying its
  own copy of that version's record layout rather than borrowing `layout`'s)
  handing its rows to the current writer — written beside the file, read
  back and counted, then renamed over it, same name and metadata. There is
  no source to import from on Android anyway: downloads and archives are
  unpacked into scratch space. Meridian runs it at start
  (`src/ime/upgrade.rs`), under the dictionary write lock every import and
  removal also takes, and reports it in the inbox's system tab; the
  keyboard, until then, says the dictionaries need upgrading rather than
  that none were imported (`DictionaryNotice`). Not in the keyboard's
  process: rebuilding rime-ice takes a few hundred megabytes for a few
  seconds (891k entries in 5.4 s, measured). **The header carries two
  versions**: `version` wrote it, `min_reader` is the oldest reader that can
  read it (0 means "same as version"), so a change that only adds sections
  leaves a newer file readable by an older build. Adding a `META` field or
  changing a section raises both. Builds that shipped checking `version == 1`
  cannot benefit — the guarantee starts with the ones that read the field.
  The fixture `ime/dict/tests/fixtures/v1.mdict` is real version 1 bytes,
  written by that writer from the `.dict.yaml` beside it.
- **Frequencies are normalised against the total of every file together.**
  Against its own total, a two-hundred-word domain table makes each of its
  words commoner than 你好 and the composer prefers them everywhere. A user's
  own word is scored as `USER_WEIGHT_SCALE` per lesson so one lesson makes it
  a common word, not a negligible one.
- **Learning is four readable TSV files with an undo for each write.** A
  commit records the word, the choice for its key string, and the transitions
  between its words (twice for an explicit choice, once for a composed
  sentence, so the composer's own output does not echo back at full weight);
  the last four commits are kept so that deleting one with Backspace and
  retyping the same keys with a different choice takes the lesson back. A
  buffer chosen in several pieces is remembered whole, and after two
  repetitions becomes a user word. Files are written atomically and flushed
  every minute and at exit; a store that cannot be opened degrades to learning
  in memory, never to writing an empty table over the user's.
  **Forgetting is a request, not an edit.** The tables belong to whichever
  process types and are written from its memory every minute, so the
  settings page editing the files would be undone by the next write; it
  files one request per file under `learn/forget/`
  (`meridian_ime_config::forget`) and the owner carries them out
  (`data::apply_forgets`): the Windows host every second, the Android
  keyboard when it comes up, either one on opening the store — erase, write,
  and only then remove the request; a write that failed (`Learner::unsaved`)
  keeps every request, or a restart would read the word back with nothing
  left to retry. A learner that only holds memory
  (`Learner::persists`) takes none, since forgetting there would leave the
  files as they were. The page lists what was learned through
  `FileLearner::read`, which never writes (`open` marks a table with a bad
  line dirty and a `FileLearner` flushes when dropped — a second writer),
  with the requests still waiting applied to what it read, so a word just
  forgotten is not listed again. `erase` removes a word from all four
  tables; the n-gram is rebuilt from the rows that do not mention it, as
  halving does, so no total is left out.
- **`host.json` is the one source of truth and the host polls it.** Meridian's
  settings page writes it, the host reloads it within a second, and nothing is
  mirrored into the preferences table where it could disagree. Dictionaries
  live in `catalog.toml` beside the files for the same reason.
- **On Android the engine is in the keyboard's own process, so there is no
  host to talk to.** `meridian-ime-android` is `ImeHost`: one `Session`,
  called directly over JNI from the keyboard service in `:ime`. One keyboard
  types into one field at a time, so there is no `Router` either. What it
  reads from disk it reads through `meridian_ime_host::data` — the same
  loaders, the same watch, the same fail-soft rules as the Windows host — so
  the two cannot disagree about what a file means; that module is why
  `meridian-ime-host` is a library as well as the Windows binary. The field
  decides privacy (`start_input(package, private)`: a password field, or
  `IME_FLAG_NO_PERSONALIZED_LEARNING`) together with `private_apps` keyed on
  the package; memory hints go to Meridian's own package and to
  `context_apps` only, and a private session withholds them itself. The
  layer on screen picks the scheme (`set_scheme`), not `host.json`. A key
  crosses JNI as four integers (`bridge.rs`, tested on the desktop); what
  comes back is the session's own JSON. Every `Java_*` function is under
  `catch_unwind`: a panic is an `IllegalStateException`, not a dead
  keyboard in somebody's chat.
- **The settings page is one page on both platforms, and importing is two steps.**
  `src-tauri/src/ime` compiles on Windows and Android: `host.json`, the
  dictionaries, the model bundles and the memory hints are the same files on
  both; the status block is each platform's own (TSF registration and the host
  on Windows; on Android whether the keyboard is enabled and selected, asked of
  `ImeBridge.kt` over JNI, with the two system screens as the only actions,
  since Android lets no app enable or select a keyboard itself). A Rime
  dictionary is several files resolved relative to its root, and Android's
  picker hands over one `content://` document and nothing beside it, so a
  dictionary arrives there as a zip. `stage_ime_dictionary` copies a
  `content://` pick in, unpacks a zip (only `.dict.yaml` entries, contained
  paths, a size cap) and lists its *root* dictionaries — the ones nothing else
  imports — and `import_staged_ime_dictionaries` imports the ones the person
  chose, refusing any path that was not listed. The unpacked copy is handed
  back when the chooser is cancelled or the page left
  (`cancel_staged_ime_dictionaries`), and the staging area is emptied at
  every start, since a pick left staged when the app closed is otherwise
  nobody's to delete. Choosing matters: rime-ice's
  archive holds an English and a radical table beside the Chinese root.
  `download_ime_rime_ice` fetches the rime-ice repository archive on request
  and imports its Chinese root; dictionaries are still imported, never shipped.
- **`meridian-ime` is the harness.** `type "nihao<space>"` replays a key
  script through the same `Session` the host runs, `lookup` ranks candidates
  against the imported dictionaries and says how long it took, `bench` scores
  the composer against expected sentences (28/30 top-1 on rime-ice at ~2 ms a
  query). The golden tests in `session/tests/golden.rs` are the same scripts.

Measured but not built: downloading a model bundle (nothing is published
yet), the tone filter the bundle's `readings.tsv` is for, the TSF DLL
reporting the text around the cursor (`surrounding` exists on the wire; the
DLL sends `None`), a language-bar button, traditional output,
`ITfTextLayoutSink` for the cases where `GetTextExt` answers
`TF_E_NOLAYOUT`, and `uiAccess` so the candidate window can sit over the
Start menu's search box.

Not built, and decided against for now (2026-09): taking a one-time code
without it being copied. vivo's own autofill service offers third-party
keyboards no inline suggestion for an SMS code, so on that device the code
reaches the toolbar only through the clipboard. The two ways round it both
want a permission a keyboard should not take lightly — `RECEIVE_SMS`, which
MIUI's and vivo's code protection may block anyway, or notification access,
which sees every app's notifications — and both would be opt-in switches
requested from the settings page, since the keyboard's process cannot show a
permission dialog. Telling a real code from an advert dressed as one, and
reading codes that are not only digits, is for the local assistant rather
than for more rules in `codeIn`.
