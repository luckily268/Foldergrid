!macro customInstall
  ; Preserve the existing choice, including Task Manager's disabled flag, while
  ; refreshing the executable path if the installation location changes.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "folder-grid"
  ${if} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "folder-grid" '"$INSTDIR\folder-grid.exe"'
  ${endIf}
!macroend

!macro customUnInstall
  ; Keep startup enabled during upgrades; clean up only on a real uninstall.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "folder-grid"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "folder-grid"
  ${endIf}
!macroend
