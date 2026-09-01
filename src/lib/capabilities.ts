import { isRemote } from './transport'

/**
 * What this session can do, as opposed to what the app can do.
 *
 * Connected to another machine, a handful of things stop meaning what they say.
 * They divide into two kinds, and the distinction is worth keeping straight:
 *
 * - **Whose disk.** "Export this conversation" writes a file, and the picker
 *   that chooses where returns a path on the machine the *user* is at. The host
 *   would happily write to its own disk, where nobody would find it. These are
 *   disabled rather than redirected, because a download is a different feature
 *   and pretending otherwise would silently put the file somewhere else.
 *
 * - **Whose hardware.** Voice input records through this device's microphone
 *   but transcribes with a model on the host, and the audio has nowhere to go
 *   over the current protocol.
 *
 * Attachments are the one case that *is* redirected: the bytes travel, so
 * picking a file still works. See the `/upload` route.
 *
 * Everything absent from this file works remotely, which is nearly all of it —
 * the conversation, the models, the tools, the settings.
 */
export const can = {
  /** Write a file to the machine the user is sitting at. */
  exportToDisk: !isRemote,
  /** Read one from it, other than as an attachment. */
  importFromDisk: !isRemote,
  /** Pick a directory — a project's working directory is on the *host*, so
   *  remote sessions type the path instead of browsing for it. */
  browseForDirectory: !isRemote,
  /** Record and transcribe. */
  voiceInput: !isRemote,
  /**
   * Drop a file onto the composer.
   *
   * True everywhere since the drop moved off Tauri's native handler onto the
   * DOM's own events (see `use-file-drop`): an HTML5 drop hands over `File`
   * objects — the bytes, not a path — which is exactly what remote mode's
   * `/upload` has always taken, and what `upload_file_bytes` now takes on the
   * host. The limit the old `!isRemote` recorded belonged to the mechanism,
   * and went with it. Kept as a capability rather than deleted, because it is
   * still a fact about the *session* the composer asks about.
   */
  dropFiles: true,
  /** Reconfigure the servers this app runs, including the one answering. */
  manageServers: !isRemote,
} as const

export type Capability = keyof typeof can
