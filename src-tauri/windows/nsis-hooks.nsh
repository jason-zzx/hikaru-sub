!macro NSIS_HOOK_PREINSTALL
  ${If} "$INSTDIR" == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\hikaru-sub"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    RMDir /r "$INSTDIR\deps"
  ${EndIf}
!macroend
