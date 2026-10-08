!macro NSIS_HOOK_PREINSTALL
  ${If} "$INSTDIR" == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\hikaru-sub"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Reuse the new binary's bounded cleanup without starting the application UI.
  ; A locked legacy environment must not fail an otherwise successful upgrade.
  Push $0
  ClearErrors
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --cleanup-legacy-python' $0
  ${If} ${Errors}
  ${OrIf} $0 != 0
    DetailPrint "旧版 Python 环境未能清理，可稍后在设置中重试。"
  ${EndIf}
  ClearErrors
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    RMDir /r "$INSTDIR\deps"
  ${EndIf}
!macroend
