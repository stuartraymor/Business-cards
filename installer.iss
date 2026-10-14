; Inno Setup script: builds installer\BusinessCardsSetup.exe
; Requires dist\BusinessCards.exe, created by build_windows.bat.

[Setup]
AppId={{6F1C2B7E-4D2A-4B8E-9C1D-BUSINESSCARDS01}
AppName=Business Cards
AppVersion=1.0.0
AppPublisher=Stuart Raymor
DefaultDirName={autopf}\Business Cards
DefaultGroupName=Business Cards
UninstallDisplayIcon={app}\BusinessCards.exe
OutputDir=installer
OutputBaseFilename=BusinessCardsSetup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "dist\BusinessCards.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Business Cards"; Filename: "{app}\BusinessCards.exe"
Name: "{group}\Uninstall Business Cards"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Business Cards"; Filename: "{app}\BusinessCards.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BusinessCards.exe"; Description: "Launch Business Cards"; Flags: nowait postinstall skipifsilent

[Code]
// Your cards live in %APPDATA%\BusinessCards, separate from the program.
// Ask before deleting them, so an uninstall never loses your data by accident.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{userappdata}\BusinessCards');
    if DirExists(DataDir) then
      if MsgBox('Also delete your saved business cards and images?' + #13#10 + #13#10 +
                DataDir + #13#10 + #13#10 +
                'Choose No to keep them.', mbConfirmation, MB_YESNO) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
