import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkIpcWireParity } from './ipc-wire-parity.mjs'

function makeFixture({ rustCmds, rustTypes, tsApi, tsTypes }) {
  const files = new Map([
    [
      'src-tauri/src/command_table.rs',
      `macro_rules! with_all_commands { ($m:ident) => { $m! { ${rustCmds} } } }\n#[cfg(test)] mod tests {}`,
    ],
    ['src-tauri/src/commands/sample.rs', rustTypes],
    ['src/api.ts', tsApi],
    ['src/types.ts', tsTypes],
  ])
  return {
    readAt: (path) => files.get(path) ?? null,
    filesUnder: (dir) => [...files.keys()].filter((k) => k.startsWith(`${dir}/`)),
  }
}

describe('checkIpcWireParity', () => {
  it('passes when commands, structs, unit enums, and tagged enums match', () => {
    const result = checkIpcWireParity(
      makeFixture({
        rustCmds: `
          sync commands::sample => test_service_key(request: $crate::commands::sample::ServiceKeyTestRequest),
          async commands::sample => submit_action(request: $crate::commands::sample::ActionRequest),
        `,
        rustTypes: `
          #[derive(serde::Deserialize)]
          #[serde(rename_all = "snake_case")]
          pub enum ServiceKey {
            Tavily,
            FishAudio,
          }
          #[derive(serde::Deserialize)]
          pub struct ServiceKeyTestRequest {
            pub service: ServiceKey,
          }
          #[derive(serde::Deserialize)]
          #[serde(tag = "kind", rename_all = "snake_case")]
          pub enum ActionInput {
            Approve,
            Deny { reason: RequiredNullable<String> },
          }
          #[derive(serde::Deserialize)]
          pub struct ActionRequest {
            pub id: String,
            pub input: ActionInput,
          }
          #[tauri::command]
          pub fn test_service_key(request: ServiceKeyTestRequest) -> Result<bool, String> { Ok(true) }
          #[tauri::command]
          pub async fn submit_action(request: ActionRequest) -> Result<(), String> { Ok(()) }
        `,
        tsApi: `
          export const api = {
            tools: {
              testServiceKey: (request: ServiceKeyTestRequest) => invoke<boolean>('test_service_key', { request }),
              submitAction: (request: ActionRequest) => invoke<void>('submit_action', { request }),
            },
          }
        `,
        tsTypes: `
          export type ServiceKey = 'tavily' | 'fish_audio'
          export interface ServiceKeyTestRequest {
            service: ServiceKey
          }
          export type ActionInput = { kind: 'approve' } | { kind: 'deny'; reason: string | null }
          export interface ActionRequest {
            id: string
            input: ActionInput
          }
        `,
      }),
    )
    assert.deepEqual(result.problems, [])
    assert.equal(result.stats.commands, 2)
  })

  it('catches ServiceKey-style unit enum wire value drift (SCREAMING_SNAKE_CASE vs snake_case)', () => {
    const result = checkIpcWireParity(
      makeFixture({
        rustCmds: `sync commands::sample => test_service_key(request: $crate::commands::sample::ServiceKeyTestRequest),`,
        rustTypes: `
          #[derive(serde::Deserialize)]
          #[serde(rename_all = "snake_case")]
          pub enum ServiceKey {
            Tavily,
            FishAudio,
          }
          #[derive(serde::Deserialize)]
          pub struct ServiceKeyTestRequest {
            pub service: ServiceKey,
          }
          #[tauri::command]
          pub fn test_service_key(request: ServiceKeyTestRequest) -> Result<bool, String> { Ok(true) }
        `,
        tsApi: `
          export const api = {
            tools: {
              testServiceKey: (request: ServiceKeyTestRequest) => invoke<boolean>('test_service_key', { request }),
            },
          }
        `,
        tsTypes: `
          export type ServiceKey = 'TAVILY' | 'FISH_AUDIO'
          export interface ServiceKeyTestRequest {
            service: ServiceKey
          }
        `,
      }),
    )
    assert.ok(result.problems.some((p) => p.includes('ServiceKey') && p.includes('FISH_AUDIO')))
  })

  it('catches missing/extra struct fields and invalid optionality on requests', () => {
    const result = checkIpcWireParity(
      makeFixture({
        rustCmds: `sync commands::sample => do_work(request: $crate::commands::sample::WorkRequest),`,
        rustTypes: `
          #[derive(serde::Deserialize)]
          pub struct WorkRequest {
            pub project_id: String,
            pub note: RequiredNullable<String>,
          }
          #[tauri::command]
          pub fn do_work(request: WorkRequest) -> Result<(), String> { Ok(()) }
        `,
        tsApi: `
          export const api = {
            work: {
              run: (request: WorkRequest) => invoke<void>('do_work', { request }),
            },
          }
        `,
        tsTypes: `
          export interface WorkRequest {
            projectId: string
            note?: string | null
          }
        `,
      }),
    )
    assert.ok(result.problems.some((p) => p.includes("缺少 Rust WorkRequest 的 wire 字段 'project_id'")))
    assert.ok(result.problems.some((p) => p.includes('WorkRequest.projectId 在 Rust WorkRequest 中不存在')))
    assert.ok(result.problems.some((p) => p.includes('WorkRequest.note 在 TS 中是可选字段')))
  })

  it('catches tagged enum variant name and variant field drift', () => {
    const result = checkIpcWireParity(
      makeFixture({
        rustCmds: `sync commands::sample => decide(request: $crate::commands::sample::DecideRequest),`,
        rustTypes: `
          #[derive(serde::Deserialize)]
          #[serde(tag = "kind", rename_all = "snake_case")]
          pub enum Decision {
            ConfirmSemantics { name: String, tags: RequiredNullable<String> },
          }
          #[derive(serde::Deserialize)]
          pub struct DecideRequest {
            pub decision: Decision,
          }
          #[tauri::command]
          pub fn decide(request: DecideRequest) -> Result<(), String> { Ok(()) }
        `,
        tsApi: `
          export const api = {
            x: {
              decide: (request: DecideRequest) => invoke<void>('decide', { request }),
            },
          }
        `,
        tsTypes: `
          export type Decision = { kind: 'confirm_semantics'; name: string; label: string | null }
          export interface DecideRequest {
            decision: Decision
          }
        `,
      }),
    )
    assert.ok(result.problems.some((p) => p.includes("缺少字段 'tags'")))
    assert.ok(result.problems.some((p) => p.includes('.label 在 Rust Decision::ConfirmSemantics 中不存在')))
  })

  it('catches commands invoked in src/api.ts that are missing from command_table.rs', () => {
    const result = checkIpcWireParity(
      makeFixture({
        rustCmds: ``,
        rustTypes: ``,
        tsApi: `export const api = { ghost: { run: () => invoke<void>('nonexistent_cmd') } }`,
        tsTypes: ``,
      }),
    )
    assert.ok(result.problems.some((p) => p.includes("'nonexistent_cmd' 未注册")))
  })
})
