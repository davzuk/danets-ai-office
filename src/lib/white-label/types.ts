/** White-label brand shape shared by server and client code. */
export interface Brand {
  appName: string;
  appShortName: string;
  primaryColor: string;
  accentColor: string;
  customLogoUrl: string | null;
  hideBranding: boolean;
  customCss: string | null;
}