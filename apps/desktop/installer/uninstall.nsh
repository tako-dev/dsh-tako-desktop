; Electron user data and updater downloads leave with the application; the Harness home is never touched.
!include FileFunc.nsh
Var UnTarget
Var UnHome

; The helper refuses unsafe roots, the installation and the Harness home, and never descends into reparse points;
; a locked file leaves residue and never fails the uninstall. customCheckAppRunning extracts window-frame.dll first.
Function un.RemoveData
  System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveData(w "$UnTarget", w "$INSTDIR", w "$UnHome") ?c'
FunctionEnd

Function un.CleanData
  ${If} ${isUpdated}
    Return
  ${EndIf}
  ; Launch at login registers a per-user Run entry; it must not outlive the installation.
  ; Electron names the value after AppUserModelId by default (${APP_ID}), with older
  ; registrations possibly stored under the product or package name.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_FILENAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCT_FILENAME}"
  !ifdef APP_PACKAGE_NAME
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_PACKAGE_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_PACKAGE_NAME}"
  !endif
  ; The installer runs an older uninstaller with /KEEP_APP_DATA when replacing it from another directory.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    Return
  ${EndIf}
  ; Only a DSH_HOME published as a Windows environment variable is visible here.
  ReadEnvStr $UnHome DSH_HOME
  ClearErrors
  StrCpy $UnTarget "$APPDATA\${PRODUCT_FILENAME}"
  Call un.RemoveData
  !ifdef APP_PACKAGE_NAME
    ; Electron derives user data from the package name; a scoped name nests it one directory deeper.
    StrCpy $UnTarget "$APPDATA\${APP_PACKAGE_NAME}"
    Call un.RemoveData
    System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveEmptyParents(w "$UnTarget", w "$APPDATA") ?c'
  !endif
  StrCpy $UnTarget "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}"
  Call un.RemoveData
FunctionEnd
