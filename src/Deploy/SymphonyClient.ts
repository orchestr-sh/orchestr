/**
 * SymphonyClient
 *
 * HTTP client wrapping fetch() for all Symphony API calls.
 * Uses only Node.js built-in fetch (Node 22+).
 */

export interface ApiError {
  error: string;
  code?: string;
}

export class SymphonyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'SymphonyApiError';
  }
}

export class SymphonyClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token?: string
  ) {}

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl.replace(/\/$/, '')}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { ...this.headers, connection: 'close' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      throw new Error(`Network error contacting ${url}: ${err?.cause?.message ?? err?.message ?? err}`);
    }

    if (!response.ok) {
      let errorBody: ApiError = { error: `HTTP ${response.status}` };
      try {
        errorBody = (await response.json()) as ApiError;
      } catch {}
      throw new SymphonyApiError(errorBody.error, response.status, errorBody.code);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // --- Auth ---

  register(email: string, password: string, name?: string) {
    return this.request<{ user: { id: number; email: string; name: string | null }; token: string }>(
      'POST',
      '/api/auth/register',
      { email, password, name }
    );
  }

  login(email: string, password: string) {
    return this.request<{ user: { id: number; email: string; name: string | null }; token: string }>(
      'POST',
      '/api/auth/login',
      { email, password }
    );
  }

  // --- Projects ---

  listProjects() {
    return this.request<{
      projects: Array<{ id: number; name: string; slug: string; repository: string | null; created_at: string }>;
    }>('GET', '/api/projects');
  }

  createProject(name: string, repository?: string) {
    return this.request<{ project: { id: number; name: string; slug: string } }>('POST', '/api/projects', {
      name,
      repository,
    });
  }

  getProject(slug: string) {
    return this.request<{ project: { id: number; name: string; slug: string; repository: string | null } }>(
      'GET',
      `/api/projects/${slug}`
    );
  }

  // --- Servers ---

  listServers(slug: string) {
    return this.request<{
      servers: Array<{
        id: number;
        name: string;
        host: string;
        port: number;
        ssh_user: string;
        deploy_path: string;
        status: string | null;
        last_deployed_at: string | null;
      }>;
    }>('GET', `/api/projects/${slug}/servers`);
  }

  addServer(
    slug: string,
    params: { name: string; host: string; port?: number; ssh_user?: string; deploy_path?: string }
  ) {
    return this.request<{
      server: {
        id: number;
        name: string;
        host: string;
        port: number;
        ssh_user: string;
        deploy_path: string;
        status: string | null;
      };
    }>('POST', `/api/projects/${slug}/servers`, params);
  }

  deleteServer(slug: string, serverId: number) {
    return this.request<void>('DELETE', `/api/projects/${slug}/servers/${serverId}`);
  }

  // --- Deployments ---

  createDeployment(
    slug: string,
    params: { server_id: number; version?: string; commit_hash?: string; commit_message?: string }
  ) {
    return this.request<{ deployment: { id: number; uuid: string; status: string } }>(
      'POST',
      `/api/projects/${slug}/deploy`,
      params
    );
  }

  listDeployments(slug: string, page = 1, perPage = 20) {
    return this.request<{
      deployments: Array<{
        id: number;
        uuid: string;
        version: string | null;
        commit_hash: string | null;
        commit_message: string | null;
        status: string | null;
        started_at: string | null;
        completed_at: string | null;
        created_at: string;
      }>;
      pagination: { page: number; per_page: number; total: number };
    }>('GET', `/api/projects/${slug}/deployments?page=${page}&per_page=${perPage}`);
  }

  updateDeployment(slug: string, uuid: string, params: { status?: string; log?: string; completed_at?: string }) {
    return this.request<{ deployment: { id: number; uuid: string; status: string } }>(
      'PATCH',
      `/api/projects/${slug}/deployments/${uuid}`,
      params
    );
  }

  // --- Environment Variables ---

  getEnvVars(slug: string) {
    return this.request<{ variables: Array<{ key: string; value: string }> }>('GET', `/api/projects/${slug}/env`);
  }

  putEnvVars(slug: string, variables: Array<{ key: string; value: string }>) {
    return this.request<{ variables: Array<{ key: string }> }>('PUT', `/api/projects/${slug}/env`, { variables });
  }

  // --- Rollback ---

  rollback(slug: string) {
    return this.request<{
      rolled_back: { id: number; uuid: string };
      restored: { id: number; uuid: string };
    }>('POST', `/api/projects/${slug}/rollback`);
  }
}
