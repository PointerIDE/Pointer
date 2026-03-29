// Electron Preload exports type declaration
declare global {
  interface Window {
    electron?: {
      window?: {
        minimize(): void;
        maximize(): void;
        close(): void;
        isMaximized(): Promise<boolean>;
      };
      discord?: {
        updateSettings(settings: any): void;
        updateEditorInfo(info: any): void;
      };
      api?: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        on(channel: string, callback: (event: any, ...args: any[]) => void): void;
        once(channel: string, callback: (event: any, ...args: any[]) => void): void;
        off(channel: string, callback: (event: any, ...args: any[]) => void): void;
      };
    };
  }
}

export {};
