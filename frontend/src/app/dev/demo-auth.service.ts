// ⚠️ DEVELOPMENT ONLY — in-memory JWT store for testing against http://localhost:4200/dev/login.
// Never use this pattern for real authentication: token is lost on page refresh
// (by design — this is a throwaway dev credential, not a session mechanism) and
// is not persisted to localStorage/sessionStorage/cookies anywhere.

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DemoAuthService {
  private readonly token = signal<string | null>(null);

  getToken(): string | null {
    return this.token();
  }

  setToken(token: string): void {
    this.token.set(token);
  }

  isAuthenticated(): boolean {
    return this.token() !== null;
  }
}
