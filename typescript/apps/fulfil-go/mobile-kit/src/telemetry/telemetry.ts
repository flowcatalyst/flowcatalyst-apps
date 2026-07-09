import BackgroundGeolocation, {
  type AuthorizationConfig,
} from '@transistorsoft/capacitor-background-geolocation';

/**
 * Driver telemetry via the Transistorsoft NATIVE HTTP uploader.
 *
 * The plugin's native side records fixes to its own on-device SQLite and
 * POSTs them to `http.url` from native code — telemetry keeps flowing while
 * the WebView is suspended and (Android, stopOnTerminate:false) after the
 * app is swiped away. JS never touches location batches; this module only
 * configures and toggles tracking.
 *
 * The `authorization` block makes the NATIVE layer attach the bearer token
 * and exchange the refresh token against our server when it expires — the
 * uploader stays authenticated with no JS awake.
 *
 * IMPORT VIA THE SUBPATH: `@fulfil-go/mobile-kit/telemetry` — the plugin is
 * an optional peer only the execution app installs; the main barrel must not
 * pull it in.
 *
 * Config shape matches plugin v9 (types v5): nested http/geolocation/app/
 * logger/authorization sections. Re-verify on plugin major bumps.
 */
export interface TelemetryConfig {
  /** OAuth client the native refresh goes through (e.g. 'execution'). */
  readonly app?: string;
  /** Ingest endpoint, e.g. `${baseUrl}/telemetry/locations`. */
  readonly url: string;
  /** Refresh endpoint, e.g. `${baseUrl}/auth/mobile/refresh`. */
  readonly refreshUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch ms when accessToken expires (drives native pre-emptive refresh). */
  readonly expiresAt: number;
  readonly debug?: boolean;
}

export interface Telemetry {
  /** Call once on app start (after login). Resolves when the plugin is ready. */
  configure(config: TelemetryConfig): Promise<void>;
  /** Push fresh tokens into the native layer after a JS-side refresh/login. */
  updateAuthorization(config: TelemetryConfig): Promise<void>;
  /** Begin on-duty tracking (starts the Android foreground service). */
  start(): Promise<void>;
  /** End the shift. */
  stop(): Promise<void>;
  isTracking(): Promise<boolean>;
}

function authorizationConfig(config: TelemetryConfig): AuthorizationConfig {
  return {
    strategy: 'JWT',
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    refreshUrl: config.refreshUrl,
    // Our refresh endpoint takes {refreshToken} and returns
    // {accessToken, refreshToken, expiresAt} — {refreshToken} interpolates
    // the plugin's current refresh token into the request body.
    refreshPayload: {
      ...(config.app ? { app: config.app } : {}),
      refreshToken: '{refreshToken}',
    },
    expires: Math.floor(config.expiresAt / 1000),
  };
}

export function createTelemetry(): Telemetry {
  return {
    async configure(config: TelemetryConfig): Promise<void> {
      await BackgroundGeolocation.ready({
        http: {
          url: config.url,
          // Batch into fewer requests; native SQLite buffers offline.
          autoSync: true,
          batchSync: true,
          maxBatchSize: 50,
        },
        geolocation: {
          // Battery-conscious defaults; tune per fleet feedback.
          // -1 = DesiredAccuracy.High (value import breaks rollup — the
          // plugin ships the enum only in its type declarations).
          desiredAccuracy: -1,
          distanceFilter: 25,
          stopTimeout: 5,
        },
        app: {
          // Keep tracking across app termination + device reboot while on-duty.
          stopOnTerminate: false,
          startOnBoot: true,
        },
        logger: { debug: config.debug ?? false },
        authorization: authorizationConfig(config),
      });
    },

    async updateAuthorization(config: TelemetryConfig): Promise<void> {
      await BackgroundGeolocation.setConfig({
        authorization: authorizationConfig(config),
      });
    },

    async start(): Promise<void> {
      await BackgroundGeolocation.start();
    },

    async stop(): Promise<void> {
      await BackgroundGeolocation.stop();
    },

    async isTracking(): Promise<boolean> {
      const state = await BackgroundGeolocation.getState();
      return state.enabled;
    },
  };
}
