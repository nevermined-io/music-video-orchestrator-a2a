/**
 * @file sessionManager.ts
 * @description Session management functionality
 */

/**
 * @class SessionManager
 * @description Manages user sessions and their state
 */
export class SessionManager {
  private sessions: Map<string, any> = new Map();

  /**
   * @method createSession
   * @description Create a new session
   */
  public createSession(sessionId: string, data: any = {}): void {
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * @method getSession
   * @description Get session by ID
   */
  public getSession(sessionId: string): any {
    return this.sessions.get(sessionId);
  }

  /**
   * @method updateSession
   * @description Update session data
   */
  public updateSession(sessionId: string, data: any): void {
    const session = this.getSession(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, ...data });
    }
  }
}
