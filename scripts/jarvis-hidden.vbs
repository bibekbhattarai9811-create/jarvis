' Starts Jarvis in the background with no window (runs scripts\jarvis-background.cmd next to this file).
' For start at sign-in, put a copy of this file in the Windows Startup folder (Win+R, shell:startup) and change
' "here" below to this scripts folder's full path, since the copy no longer sits next to the .cmd.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & here & "\jarvis-background.cmd""", 0, False
