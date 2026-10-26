; Groundwork Native Windows Installer Script
; Inno Setup 6

#define MyAppName "Groundwork"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Groundwork Team"
#define MyAppURL "https://github.com/ttnhan227/Groundwork"
#define MyAppExeName "Groundwork.Desktop.exe"

[Setup]
AppId={{D41A28A7-873B-4DF0-97F4-F648A96DE1A9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=Groundwork-v{#MyAppVersion}-windows-x64-setup
SetupIconFile=..\src\Groundwork.Desktop\Assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\..\dist\Groundwork\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
const
	ExistingUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{D41A28A7-873B-4DF0-97F4-F648A96DE1A9}_is1';

var
	ExistingInstallPage: TInputOptionWizardPage;
	ExistingVersion: String;
	ExistingInstallDir: String;
	ExistingUninstaller: String;

function FindExistingInstall: Boolean;
begin
	Result := RegQueryStringValue(HKCU, ExistingUninstallKey, 'DisplayVersion', ExistingVersion) and
		RegQueryStringValue(HKCU, ExistingUninstallKey, 'InstallLocation', ExistingInstallDir);

	if not Result then
	begin
		Result := RegQueryStringValue(HKLM, ExistingUninstallKey, 'DisplayVersion', ExistingVersion) and
			RegQueryStringValue(HKLM, ExistingUninstallKey, 'InstallLocation', ExistingInstallDir);
	end;

	if Result then
	begin
		ExistingUninstaller := AddBackslash(ExistingInstallDir) + 'unins000.exe';
		Result := FileExists(ExistingUninstaller);
	end;
end;

procedure InitializeWizard;
begin
	if FindExistingInstall then
	begin
		ExistingInstallPage := CreateInputOptionPage(
			wpWelcome,
			'Existing Groundwork installation found',
			'Groundwork ' + ExistingVersion + ' is already installed.',
			'Choose whether to update it or remove it.',
			True,
			False);
		ExistingInstallPage.Add('Update to Groundwork {#MyAppVersion}');
		ExistingInstallPage.Add('Uninstall Groundwork and close setup');
		ExistingInstallPage.SelectedValueIndex := 0;
	end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
	ResultCode: Integer;
begin
	Result := True;
	if Assigned(ExistingInstallPage) and
		(CurPageID = ExistingInstallPage.ID) and
		(ExistingInstallPage.SelectedValueIndex = 1) then
	begin
		if MsgBox(
			'This will remove Groundwork ' + ExistingVersion + ' and its application files. Continue?',
			mbConfirmation,
			MB_YESNO) <> IDYES then
		begin
			Result := False;
			Exit;
		end;

		if not Exec(
			ExistingUninstaller,
			'/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
			'',
			SW_HIDE,
			ewWaitUntilTerminated,
			ResultCode) then
		begin
			MsgBox('Could not start the Groundwork uninstaller.', mbError, MB_OK);
			Result := False;
			Exit;
		end;

		if ResultCode <> 0 then
		begin
			MsgBox('Groundwork could not be completely removed. Setup will remain open.', mbError, MB_OK);
			Result := False;
			Exit;
		end;

		MsgBox('Groundwork has been removed.', mbInformation, MB_OK);
		Result := False;
		WizardForm.Close;
	end;
end;
