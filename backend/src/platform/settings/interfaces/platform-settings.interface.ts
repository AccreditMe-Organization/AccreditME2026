export interface IPlatformAnnouncement {
  message: string;
  severity: 'info' | 'warning';
  activeFrom: string | null;
  activeUntil: string | null;
}

export interface IPlatformSettings {
  announcement: IPlatformAnnouncement | null;
}
