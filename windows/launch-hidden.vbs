Option Explicit

Dim shell, fso, scriptDir, appRoot, nodePath, mainPath, command, index
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
nodePath = appRoot & "\runtime\node\node.exe"
mainPath = appRoot & "\backend\main.mjs"

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & mainPath & Chr(34)
For index = 0 To WScript.Arguments.Count - 1
  command = command & " " & Chr(34) & Replace(WScript.Arguments(index), Chr(34), "") & Chr(34)
Next

shell.CurrentDirectory = appRoot
shell.Run command, 0, False
