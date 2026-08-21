const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token: string;
  error?: string;
  error_description?: string;
}

interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type: string; message?: string }) => void;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: {
      initTokenClient(config: TokenClientConfig): TokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let scriptPromise: Promise<void> | undefined;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google !== undefined) {
    return Promise.resolve();
  }

  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing: HTMLScriptElement | null = document.querySelector(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`
    );
    const script: HTMLScriptElement = existing ?? document.createElement('script');

    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Identity Services failed to load.')), {
      once: true
    });

    if (existing === null) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export async function requestDriveAccessToken(clientId: string): Promise<string> {
  await loadGoogleIdentityServices();

  const google: GoogleIdentityServices | undefined = window.google;
  if (google === undefined) {
    throw new Error('Google Identity Services is unavailable.');
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient: TokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: (response: TokenResponse): void => {
        if (response.error !== undefined) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (error): void => reject(new Error(error.message ?? error.type))
    });

    tokenClient.requestAccessToken();
  });
}

export {};
