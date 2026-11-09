; Inno Setup script for the Windows installer. Built by the release workflow:
;   ISCC /DAppVersion=1.2.3 /DSourceExe=C:\path\to\research-agent.exe installer\windows.iss
; Installs per user (no administrator rights needed).
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8C1E5B0A-6B0D-4F3B-9E55-2A7B1C0D9F11}
AppName=Research Agent
AppVersion={#AppVersion}
AppPublisher=Research Agent
DefaultDirName={autopf}\Research Agent
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=ResearchAgent-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Research Agent

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "Research Agent.exe"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Research Agent"; Filename: "{app}\Research Agent.exe"
Name: "{autodesktop}\Research Agent"; Filename: "{app}\Research Agent.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Research Agent.exe"; Description: "Launch Research Agent"; Flags: nowait postinstall skipifsilent
