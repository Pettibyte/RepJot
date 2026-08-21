# RepJot

Lightweight fitness journal tool. Works on not-so-modern browsers such as Kindle Scribe so you can log workouts on a distraction-free device.

The current prototype is a minimal Svelte/TypeScript app that stores a hello-world
document in the signed-in user's private Google Drive `appDataFolder`.

## Run locally

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and configure the Google OAuth client ID.
3. Start the app with `bun run dev` and open `http://localhost:5173`.

Run `bun run check` for strict TypeScript/Svelte checks and `bun run build` to produce
the two-file static bundle in `dist/`.

## Configure Google OAuth

1. Create or select a project in the Google Cloud Console.
2. Enable **Google Drive API** under **APIs & Services > Library**.
3. Open **Google Auth Platform**, complete **Branding**, and choose an audience. For an
   external prototype in testing, add your Google account under **Audience > Test users**.
4. Under **Data Access**, add the
   `https://www.googleapis.com/auth/drive.appdata` scope.
5. Under **Clients**, create a client with application type **Web application**.
6. Add `http://localhost` and `http://localhost:5173` as **Authorized JavaScript origins**.
   No redirect URI is needed for this popup-based flow.
7. Create `.env.local` from the example and insert the generated client ID:

   ```dotenv
   VITE_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
   ```

The web client ID is public configuration and is embedded in `dist/app.js`. Do not add
the client secret to this project. Restart `bun run dev` after changing `.env.local`.
