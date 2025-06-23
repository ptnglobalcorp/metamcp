import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  SSEClientTransport,
  SseError,
} from '@modelcontextprotocol/sdk/client/sse.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CancelledNotificationSchema,
  ClientNotification,
  ClientRequest,
  CompleteResultSchema,
  CreateMessageRequestSchema,
  ErrorCode,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  McpError,
  Progress,
  PromptListChangedNotificationSchema,
  PromptReference,
  Request,
  ResourceListChangedNotificationSchema,
  ResourceReference,
  ResourceUpdatedNotificationSchema,
  Result,
  ServerCapabilities,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { useState } from 'react';
import useSWR from 'swr';
import { z } from 'zod';

import { getMcpServerByUuid } from '@/app/actions/mcp-servers';
import { McpServerType } from '@/db/schema';
import { useToast } from '@/hooks/use-toast';
import { ConnectionStatus, SESSION_KEYS } from '@/lib/constants';
import {
  Notification,
  StdErrNotificationSchema,
} from '@/lib/notificationTypes';
import { createAuthProvider } from '@/lib/oauth-provider';
import packageJson from '@/package.json';
import { McpServer } from '@/types/mcp-server';

interface UseConnectionOptions {
  mcpServerUuid: string;
  currentProfileUuid?: string;
  bearerToken?: string;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  onPendingRequest?: (request: any, resolve: any, reject: any) => void;
  getRoots?: () => any[];
}

export function useConnection({
  mcpServerUuid,
  currentProfileUuid,
  bearerToken: providedBearerToken,
  onNotification,
  onStdErrNotification,
  onPendingRequest,
  getRoots,
}: UseConnectionOptions) {
  const authProvider = createAuthProvider(mcpServerUuid, currentProfileUuid);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const { toast } = useToast();
  const [serverCapabilities, setServerCapabilities] =
    useState<ServerCapabilities | null>(null);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [completionsSupported, setCompletionsSupported] = useState(true);

  // Fetch MCP server data using SWR
  const { data: mcpServer } = useSWR<McpServer | undefined>(
    mcpServerUuid && currentProfileUuid
      ? ['getMcpServerByUuid', mcpServerUuid, currentProfileUuid]
      : null,
    () => getMcpServerByUuid(currentProfileUuid || '', mcpServerUuid)
  );

  const pushHistory = (request: object, response?: object) => {
    setRequestHistory((prev) => [
      ...prev,
      {
        request: JSON.stringify(request),
        response: response !== undefined ? JSON.stringify(response) : undefined,
      },
    ]);
  };

  const makeRequest = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean }
  ): Promise<z.output<T>> => {
    if (!mcpClient) {
      throw new Error('MCP client not connected');
    }
    try {
      const abortController = new AbortController();

      // prepare MCP Client request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress ?? true,
        timeout: options?.timeout ?? 6000,
        maxTotalTimeout: options?.maxTotalTimeout ?? 6000,
      };

      // If progress notifications are enabled, add an onprogress hook to the MCP Client request options
      // This is required by SDK to reset the timeout on progress notifications
      if (mcpRequestOptions.resetTimeoutOnProgress) {
        mcpRequestOptions.onprogress = (params: Progress) => {
          // Add progress notification to `Server Notification` window in the UI
          if (onNotification) {
            onNotification({
              method: 'notification/progress',
              params,
            });
          }
        };
      }

      let response;
      try {
        response = await mcpClient.request(request, schema, mcpRequestOptions);

        pushHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        pushHistory(request, { error: errorMessage });
        throw error;
      }

      return response;
    } catch (e: unknown) {
      if (!options?.suppressToast) {
        const errorString = (e as Error).message ?? String(e);
        toast({
          title: 'Error',
          description: errorString,
          variant: 'destructive',
        });
      }
      throw e;
    }
  };

  const handleCompletion = async (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
    signal?: AbortSignal
  ): Promise<string[]> => {
    if (!mcpClient || !completionsSupported) {
      return [];
    }

    const request: ClientRequest = {
      method: 'completion/complete',
      params: {
        argument: {
          name: argName,
          value,
        },
        ref,
      },
    };

    try {
      const response = await makeRequest(request, CompleteResultSchema, {
        signal,
        suppressToast: true,
      });
      return response?.completion.values || [];
    } catch (e: unknown) {
      // Disable completions silently if the server doesn't support them.
      // See https://github.com/modelcontextprotocol/specification/discussions/122
      if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
        setCompletionsSupported(false);
        return [];
      }

      // Unexpected errors - show toast and rethrow
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      throw e;
    }
  };

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      const error = new Error('MCP client not connected');
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    }

    try {
      await mcpClient.notification(notification);
      // Log successful notifications
      pushHistory(notification);
    } catch (e: unknown) {
      if (e instanceof McpError) {
        // Log MCP protocol errors
        pushHistory(notification, { error: e.message });
      }
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      throw e;
    }
  };

  const checkProxyHealth = async () => {
    try {
      const proxyHealthUrl = new URL(
        process.env.USE_DOCKER_HOST === 'true'
          ? `${process.env.NEXT_PUBLIC_INTERNAL_REMOTE_HOTING_URL}/health`
          : `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/health`
      );
      const proxyHealthResponse = await fetch(proxyHealthUrl);
      const proxyHealth = await proxyHealthResponse.json();
      if (proxyHealth?.status !== 'ok') {
        throw new Error('MCP Proxy Server is not healthy');
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  };

  const handleAuthError = async (error: unknown) => {
    if (error instanceof SseError && error.code === 401) {
      sessionStorage.setItem(SESSION_KEYS.SERVER_URL, mcpServer?.url || '');
      sessionStorage.setItem(SESSION_KEYS.MCP_SERVER_UUID, mcpServerUuid);
      if (currentProfileUuid) {
        sessionStorage.setItem(SESSION_KEYS.PROFILE_UUID, currentProfileUuid);
      }

      const result = await auth(authProvider, {
        serverUrl: mcpServer?.url || '',
      });
      return result === 'AUTHORIZED';
    }

    return false;
  };

  const connect = async (_e?: unknown, retryCount: number = 0) => {
    if (!mcpServer) {
      toast({
        title: 'Error',
        description: 'MCP server data not available',
        variant: 'destructive',
      });
      setConnectionStatus('error');
      return;
    }

    const client = new Client<Request, Notification, Result>(
      {
        name: 'mcp-inspector',
        version: packageJson.version,
      },
      {
        capabilities: {
          sampling: {},
          roots: {
            listChanged: true,
          },
        },
      }
    );

    try {
      await checkProxyHealth();
    } catch {
      setConnectionStatus('error-connecting-to-proxy');
      return;
    }
    const mcpProxyServerUrl = new URL(
      process.env.USE_DOCKER_HOST === 'true'
        ? `${process.env.NEXT_PUBLIC_INTERNAL_REMOTE_HOSTING_URL}/server/${mcpServerUuid}/sse`
        : `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/server/${mcpServerUuid}/sse`
    );
    mcpProxyServerUrl.searchParams.append(
      'transportType',
      mcpServer.type.toLowerCase()
    );
    if (mcpServer.type === McpServerType.STDIO) {
      mcpProxyServerUrl.searchParams.append('command', mcpServer.command || '');
      mcpProxyServerUrl.searchParams.append('args', mcpServer.args.join(' '));
      mcpProxyServerUrl.searchParams.append(
        'env',
        JSON.stringify(mcpServer.env)
      );
    } else {
      mcpProxyServerUrl.searchParams.append('url', mcpServer.url || '');
    }

    try {
      // Inject auth manually instead of using SSEClientTransport, because we're
      // proxying through the inspector server first.
      const headers: HeadersInit = {};

      // Use manually provided bearer token if available, otherwise use OAuth tokens
      const token =
        providedBearerToken || (await authProvider.tokens())?.access_token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const clientTransport = new SSEClientTransport(mcpProxyServerUrl, {
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
        requestInit: {
          headers,
        },
      });

      if (onNotification) {
        [
          CancelledNotificationSchema,
          LoggingMessageNotificationSchema,
          ResourceUpdatedNotificationSchema,
          ResourceListChangedNotificationSchema,
          ToolListChangedNotificationSchema,
          PromptListChangedNotificationSchema,
        ].forEach((notificationSchema) => {
          client.setNotificationHandler(notificationSchema, onNotification);
        });

        client.fallbackNotificationHandler = (
          notification: Notification
        ): Promise<void> => {
          onNotification(notification);
          return Promise.resolve();
        };
      }

      if (onStdErrNotification) {
        client.setNotificationHandler(
          StdErrNotificationSchema,
          onStdErrNotification
        );
      }

      try {
        await client.connect(clientTransport);
      } catch (error) {
        console.error(
          `Failed to connect to MCP Server via the MCP Inspector Proxy: ${mcpProxyServerUrl}:`,
          error
        );
        const shouldRetry = await handleAuthError(error);
        if (shouldRetry) {
          return connect(undefined, retryCount + 1);
        }

        if (error instanceof SseError && error.code === 401) {
          // Don't set error state if we're about to redirect for auth
          return;
        }
        throw error;
      }

      const capabilities = client.getServerCapabilities();
      setServerCapabilities(capabilities ?? null);
      setCompletionsSupported(true); // Reset completions support on new connection

      if (onPendingRequest) {
        client.setRequestHandler(CreateMessageRequestSchema, (request) => {
          return new Promise((resolve, reject) => {
            onPendingRequest(request, resolve, reject);
          });
        });
      }

      if (getRoots) {
        client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: getRoots() };
        });
      }

      setMcpClient(client);
      setConnectionStatus('connected');
    } catch (e) {
      console.error(e);
      setConnectionStatus('error');
    }
  };

  const disconnect = async () => {
    await mcpClient?.close();
    setMcpClient(null);
    setConnectionStatus('disconnected');
    setCompletionsSupported(false);
    setServerCapabilities(null);
  };

  return {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    handleCompletion,
    completionsSupported,
    connect,
    disconnect,
  };
}
