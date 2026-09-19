; Meridian input method: everything the installer does for it, in one file.
; Included at the top of nsis/installer.nsi (Meridian's fork of Tauri's
; template) through bundle > windows > nsis > installerHooks; the fork
; inserts IME_SECTION_INSTALL and friends where its own sections are, and the
; NSIS_HOOK_* macros are picked up by the same `!ifmacrodef` the stock
; template has. Written against the template's names: ${PRODUCTNAME},
; ${VERSION}, ${UNINSTKEY}, ${MANUPRODUCTKEY}, $UpdateMode, $PassiveMode,
; and the nsis_tauri_utils plugin it loads for its own process handling.
;
; Two facts about the process this runs in shape most of it. The installer is
; a 32-bit executable, so on 64-bit Windows `$SYSDIR` is silently redirected
; to SysWOW64 and the 64-bit regsvr32 has to be reached through the
; `Sysnative` alias, which exists only for 32-bit callers. And a TSF text
; service, once registered, is mapped into every process with a text field:
; the file cannot be replaced in place, which is why the DLLs carry the
; version in their name and an older one is deleted rather than overwritten.
;
; makensis is run with -INPUTCHARSET UTF8, so non-ASCII is safe here; the
; shortcut name is ASCII anyway so the MSI (code page 1252) can use the same.

!define MERIDIAN_IME_HOOKS
; SF_SELECTED / SelectSection / UnselectSection. Include-guarded upstream.
!include Sections.nsh

!define IME_HOST "meridian-ime-host.exe"
!define IME_DIR "$INSTDIR\ime"
; Where build.rs staged the artifacts: this file is src-tauri/nsis/, the
; staging directory is src-tauri/resources/ime/. Resolved at compile time
; from the include's own location, so it does not depend on where the
; rendered installer.nsi lands (target/<triple?>/release/nsis/<arch>).
!define IME_SRC "${__FILEDIR__}\..\resources\ime"
!define IME_DLL64_NAME "meridian_ime_tsf-${VERSION}.dll"
!define IME_DLL32_NAME "meridian_ime_tsf32-${VERSION}.dll"
!define IME_DLL64 "${IME_DIR}\${IME_DLL64_NAME}"
!define IME_DLL32 "${IME_DIR}\${IME_DLL32_NAME}"
!define IME_STARTUP_LNK "$SMSTARTUP\Meridian IME.lnk"
; Under ${UNINSTKEY}, so it lives exactly as long as the install does: read
; by IMEInitSelection to preselect the section the way it was last chosen,
; and by the uninstaller. The MSI needs none: its feature state is in the
; Windows Installer database.
!define IME_MARKER "IMEInstalled"

; Building with the input method config and without its artifacts is a
; mistake, not a variant: refuse at compile time rather than produce an
; installer whose section copies nothing. The 32-bit DLL alone is optional
; (32-bit apps lose the input method, nothing else does).
!if ! /FileExists "${IME_SRC}\${IME_DLL64_NAME}"
  !error "${IME_SRC}\${IME_DLL64_NAME} is missing: run `pnpm ime:build` (and `cargo build -p meridian` to stage) before bundling with tauri.ime.conf.json"
!endif
!if ! /FileExists "${IME_SRC}\${IME_HOST}"
  !error "${IME_SRC}\${IME_HOST} is missing: run `pnpm ime:build` before bundling with tauri.ime.conf.json"
!endif
!if ! /FileExists "${IME_SRC}\meridian-ime.ico"
  !error "${IME_SRC}\meridian-ime.ico is missing: `cargo build -p meridian` stages it from icons/icon.ico"
!endif
!if ! /FileExists "${IME_SRC}\${IME_DLL32_NAME}"
  !warning "${IME_SRC}\${IME_DLL32_NAME} is missing; this installer will not serve 32-bit applications (rustup target add i686-pc-windows-msvc, then pnpm ime:build)"
!endif

; The host keeps its file name across versions, so whichever copy is running
; is the one about to be overwritten. Failure is ignored: not running is the
; common case. Same plugin call the template makes for the main binary.
!macro IMEKillHost
  nsis_tauri_utils::KillProcess "${IME_HOST}"
  Pop $R0
!macroend

; Reported in the log always, and in a box when somebody is watching: an
; input method that silently failed to register looks like one that was
; never installed. The rest of the install is not rolled back over it.
!macro IMERegisterFailed what
  DetailPrint "${what} failed: regsvr32 exit code $R0"
  ${If} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONEXCLAMATION "${what} failed (regsvr32 exit code $R0).$\r$\n$\r$\n${PRODUCTNAME} itself is installed. Run the installer again to retry."
  ${EndIf}
!macroend

; `regsvr32 /u` on every versioned DLL present, whichever version it is.
; Every version registers the same CLSID and the same TSF profiles, so
; unregistering any one of them removes the registration; doing it for each
; is harmless. Names are matched by prefix because a stray name would be
; sent to the wrong regsvr32 otherwise: the 32-bit loader cannot load the
; 64-bit DLL and vice versa, and /s would hide that.
!macro IMEUnregisterAll
  FindFirst $R0 $R1 "${IME_DIR}\meridian_ime_tsf*.dll"
  ${DoWhile} $R1 != ""
    StrCpy $R2 $R1 18
    ${If} $R2 == "meridian_ime_tsf32"
      DetailPrint "Unregistering the input method (x86): $R1"
      ExecWait '"$WINDIR\SysWOW64\regsvr32.exe" /u /s "${IME_DIR}\$R1"' $R3
    ${Else}
      DetailPrint "Unregistering the input method (x64): $R1"
      ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /u /s "${IME_DIR}\$R1"' $R3
    ${EndIf}
    FindNext $R0 $R1
  ${Loop}
  FindClose $R0
!macroend

; Delete every versioned TSF DLL that is not this version's. Never
; `regsvr32 /u` them: that would remove the registration the new file has
; just written (see IMEUnregisterAll). /REBOOTOK because the old DLL stays
; mapped into every process with a text field until that process exits.
Function IMEPruneOldDlls
  Push $R0
  Push $R1
  FindFirst $R0 $R1 "${IME_DIR}\meridian_ime_tsf*.dll"
  ${DoWhile} $R1 != ""
    ${If} $R1 != "${IME_DLL64_NAME}"
    ${AndIf} $R1 != "${IME_DLL32_NAME}"
      DetailPrint "Removing previous input method library $R1"
      Delete /REBOOTOK "${IME_DIR}\$R1"
    ${EndIf}
    FindNext $R0 $R1
  ${Loop}
  FindClose $R0
  Pop $R1
  Pop $R0
FunctionEnd

; The body of `Section "Meridian 输入法" SecIME` in the forked template. Runs
; only when the section is selected, after the main section has written the
; app and its uninstall key.
!macro IME_SECTION_INSTALL
  SetOutPath "${IME_DIR}"
  File "${IME_SRC}\${IME_HOST}"
  File "${IME_SRC}\meridian-ime.ico"
  ; `try`: a same-version DLL still mapped into some application cannot be
  ; overwritten, and the default would put an Abort/Retry/Ignore box in front
  ; of the user (or abort a silent install). The file on disk is the same
  ; version's build; keeping it costs nothing, and the registration below
  ; re-points at it anyway.
  SetOverwrite try
  File "${IME_SRC}\${IME_DLL64_NAME}"
  !if /FileExists "${IME_SRC}\${IME_DLL32_NAME}"
    File "${IME_SRC}\${IME_DLL32_NAME}"
  !endif
  SetOverwrite on
  SetOutPath "$INSTDIR"

  ; AppContainer processes (UWP apps, the Store builds of things) load the
  ; text service too, and they run as "ALL APPLICATION PACKAGES"
  ; (S-1-15-2-1), which Program Files grants by inheritance but a custom
  ; install directory need not. By SID, because the name is localised. /T /C
  ; /Q: recurse, continue past errors, no per-file chatter. nsExec so the
  ; console window never appears.
  DetailPrint "Granting AppContainer read access to ${IME_DIR}"
  nsExec::ExecToLog 'icacls "${IME_DIR}" /grant *S-1-15-2-1:(OI)(CI)RX /T /C /Q'
  Pop $R0

  ; The 64-bit regsvr32, through Sysnative (see the header). regsvr32 is a
  ; windowed program, so ExecWait shows nothing; /s keeps its own message
  ; boxes away, and the exit code carries the failure class instead.
  DetailPrint "Registering the input method (x64)"
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s "${IME_DLL64}"' $R0
  ${If} $R0 <> 0
    !insertmacro IMERegisterFailed "Registering the 64-bit input method"
  ${EndIf}

  ; 32-bit apps (WPS, the 32-bit QQ) load a 32-bit text service, found
  ; under the same CLSID in WOW6432Node; SysWOW64\regsvr32.exe writes there.
  ${If} ${FileExists} "${IME_DLL32}"
    DetailPrint "Registering the input method (x86)"
    ExecWait '"$WINDIR\SysWOW64\regsvr32.exe" /s "${IME_DLL32}"' $R0
    ${If} $R0 <> 0
      !insertmacro IMERegisterFailed "Registering the 32-bit input method"
    ${EndIf}
  ${EndIf}

  ; After registering, so a failure above leaves the previous file on disk.
  Call IMEPruneOldDlls

  ; A Startup shortcut for every user: the host holds the engine and draws
  ; the candidate window, and a text service with no host is a keyboard
  ; that swallows keys. $SMSTARTUP follows the shell var context, which the
  ; template's SetContext already put on `all` for a perMachine install;
  ; set again rather than relied on.
  SetShellVarContext all
  CreateShortCut "${IME_STARTUP_LNK}" "${IME_DIR}\${IME_HOST}" "" "${IME_DIR}\meridian-ime.ico"

  WriteRegDWORD SHCTX "${UNINSTKEY}" "${IME_MARKER}" 1

  ; Start the host now, as the logged-in user rather than as this elevated
  ; process: the template's own plugin call, the one its finish page uses
  ; for the main binary.
  nsis_tauri_utils::RunAsUser "${IME_DIR}\${IME_HOST}" ""
!macroend

; The body of the hidden section that follows SecIME. When the input method
; was not selected this time but an earlier install put it here (an upgrade
; where the box was unticked), it is taken out: files left registered would
; keep working until the next prune deleted them from under ctfmon.
!macro IME_SECTION_REMOVE_UNSELECTED SEC
  ${IfNot} ${SectionIsSelected} ${SEC}
    ${If} ${FileExists} "${IME_DIR}\meridian_ime_tsf*.dll"
      DetailPrint "Input method not selected; removing the earlier installation"
      !insertmacro IMEUnregisterAll
      Delete /REBOOTOK "${IME_DIR}\*.*"
      RMDir /REBOOTOK "${IME_DIR}"
    ${EndIf}
    SetShellVarContext all
    Delete "${IME_STARTUP_LNK}"
    DeleteRegValue SHCTX "${UNINSTKEY}" "${IME_MARKER}"
  ${EndIf}
!macroend

; Called from .onInit (through IMEInitSelection in the fork, since ${SecIME}
; is only defined once the section has been read). /NOIME on the command
; line deselects the section, which is how a silent or passive install --
; the updater's /UPDATE /P included -- says no, since neither shows the
; page. Otherwise, over an existing install, the section defaults to what
; that install chose, so an update keeps the input method exactly when it
; was there before; a first install defaults to selected.
!macro IME_INIT_SELECTION SEC
  ClearErrors
  ${GetOptions} $CMDLINE "/NOIME" $R0
  ${IfNot} ${Errors}
    !insertmacro UnselectSection ${SEC}
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "UninstallString"
    ${If} $R0 != ""
      ReadRegDWORD $R1 SHCTX "${UNINSTKEY}" "${IME_MARKER}"
      ${If} $R1 = 1
        !insertmacro SelectSection ${SEC}
      ${Else}
        !insertmacro UnselectSection ${SEC}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro IMEKillHost

  ; A per-user install from before the input method (installMode was
  ; currentUser) keeps its metadata under HKCU, where this perMachine
  ; installer never looks: the template's reinstall page reads SHCTX, which
  ; is HKLM now. Left alone it stays in Add/Remove Programs beside this one,
  ; with its own copy of the app under %LOCALAPPDATA%. So its uninstaller is
  ; run first. `_?=` makes it run in place instead of copying itself to %TEMP%
  ; and returning at once, which is the only way ExecWait actually waits; the
  ; price is that it cannot delete itself, so its file and directory are
  ; removed here afterwards. /P is passive: no pages, no prompts, and the
  ; "delete app data" checkbox is never shown, so the user's data survives
  ; the move. The UninstallString the template writes is already quoted.
  ;
  ; Known limit: HKCU here is the hive of whoever elevated. A standard user
  ; who types an administrator's credentials into the UAC prompt keeps their
  ; own per-user copy, because this process cannot see it.
  ClearErrors
  ReadRegStr $R0 HKCU "${UNINSTKEY}" "UninstallString"
  ReadRegStr $R1 HKCU "${MANUPRODUCTKEY}" ""
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    DetailPrint "Removing the per-user ${PRODUCTNAME} install in $R1"
    ExecWait '$R0 /P _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro IMEKillHost

  ; /UPDATE means the new version is about to be installed over this one,
  ; and it registers the same CLSID and profiles: unregistering here would
  ; only take the input method off the language bar for the seconds in
  ; between, and off it for good if the new installer then failed. Before
  ; the template deletes files, because DllUnregisterServer has to be called
  ; from a DLL that is still on disk. Nothing is done when the input method
  ; was never installed: the loop finds no file.
  ${If} $UpdateMode <> 1
    !insertmacro IMEUnregisterAll
    SetShellVarContext all
    Delete "${IME_STARTUP_LNK}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; The section's files are not in the template's resource list, so its
    ; uninstall deletes none of them; and a DLL still mapped into a running
    ; process needs /REBOOTOK, which that list never uses. Its
    ; `RMDir "$INSTDIR"` also ran while ime\ was still non-empty, so the
    ; directory is retried here.
    Delete /REBOOTOK "${IME_DIR}\*.*"
    RMDir /REBOOTOK "${IME_DIR}"
    RMDir /REBOOTOK "$INSTDIR"
  ${EndIf}
!macroend
