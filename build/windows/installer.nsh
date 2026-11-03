; LibreShard NSIS additions (build.nsis.include). The installer is per user and never needs admin
; rights; the only exception is an optional Windows Firewall rule, which it asks for first.
;
; Why a rule: tablets connect to LibreShard's server over the LAN. Without a rule, Windows asks on
; the first start, and it's easy to allow public networks too by mistake. This rule allows
; LibreShard on private networks only. Adding or removing a firewall rule needs administrator
; rights, so it's a separate UAC prompt the user can decline (Windows then asks on the first start,
; as for any app).

!define LS_RULE "LibreShard"

; Sets $R9 to 1 if the rule exists (netsh can list rules without admin rights)
!macro lsRuleExists
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall show rule name="${LS_RULE}"'
  Pop $R9
  Pop $R8
  ${if} $R9 == 0
    StrCpy $R9 1
  ${else}
    StrCpy $R9 0
  ${endif}
!macroend

; Sets $R7 to 1 when the installer runs in Spanish ($LANGUAGE's primary language id is 0x0A)
!macro lsSpanish
  IntOp $R7 $LANGUAGE & 0x3FF
  ${if} $R7 == 10
    StrCpy $R7 1
  ${else}
    StrCpy $R7 0
  ${endif}
!macroend

!macro customInstall
  !insertmacro lsRuleExists
  ${if} $R9 == 0
    !insertmacro lsSpanish
    ${if} $R7 == 1
      StrCpy $R6 "LibreShard necesita una regla del Firewall de Windows para que tus tablets se conecten desde tu red privada (nunca desde redes públicas).$\r$\n$\r$\nAñadirla pide permiso de administrador una sola vez. Si dices que no, Windows te preguntará al abrir LibreShard por primera vez.$\r$\n$\r$\n¿Añadir la regla ahora?"
    ${else}
      StrCpy $R6 "LibreShard needs a Windows Firewall rule so your tablets can connect from your private network (never from public networks).$\r$\n$\r$\nAdding it asks for administrator permission once. If you say no, Windows will ask the first time you open LibreShard.$\r$\n$\r$\nAdd the rule now?"
    ${endif}
    MessageBox MB_YESNO|MB_ICONQUESTION "$R6" /SD IDNO IDNO lsSkipRule
      ExecShell "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall add rule name="${LS_RULE}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP profile=private enable=yes' SW_HIDE
    lsSkipRule:
  ${endif}
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first: keep the rule and the file type then
  ${ifNot} ${isUpdated}
    ; electron-builder removes the "LibreShard shard" class but leaves ".libreshard" pointing to it.
    ; The extension is ours: remove it too, unless another program took it over.
    ReadRegStr $R5 SHELL_CONTEXT "Software\Classes\.libreshard" ""
    ${if} $R5 == "LibreShard shard"
      DeleteRegKey SHELL_CONTEXT "Software\Classes\.libreshard"
    ${endif}
    ${ifNot} ${Silent}
      !insertmacro lsRuleExists
      ${if} $R9 == 1
        ExecShell "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="${LS_RULE}"' SW_HIDE
      ${endif}
    ${endIf}
  ${endIf}
!macroend
