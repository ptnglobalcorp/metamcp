'use client';

import { Copy, Terminal } from 'lucide-react';
import useSWR from 'swr';

import { getFirstApiKey } from '@/app/actions/api-keys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProjects } from '@/hooks/use-projects';
import { useToast } from '@/hooks/use-toast';

export default function InspectorGuidePage() {
  const { currentProject } = useProjects();
  const { data: apiKey } = useSWR(
    currentProject?.uuid ? `${currentProject?.uuid}/api-keys/getFirst` : null,
    () => getFirstApiKey(currentProject?.uuid || '')
  );
  const { toast } = useToast();

  const inspectorCommand = `npx -y @modelcontextprotocol/inspector npx -y @metamcp/mcp-server-metamcp@latest -e METAMCP_API_KEY=${apiKey?.api_key || '<YOUR_API_KEY>'} -e METAMCP_API_BASE_URL=${process.env.NEXT_PUBLIC_METATOOL_APP_URL}`;

  const sseEndpoint = `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/sse with Authorization: Bearer ${apiKey?.api_key || '<YOUR_API_KEY>'}`;
  const urlBasedSseEndpoint = `${process.env.NEXT_PUBLIC_REMOTE_HOSTING_URL}/api-key/${apiKey?.api_key || '<YOUR_API_KEY>'}/sse`;

  return (
    <div className='container mx-auto py-6 flex flex-col items-start justify-center gap-6'>
      <h1 className='text-2xl font-semibold'>
        Remote SSE Mode Inspector Guide
      </h1>

      <Card className='w-full'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Terminal className='h-5 w-5' />
            UI SSE Mode in Inspector
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className='mb-4'>
            You can use the SSE mode to trigger the inspector directly from your
            UI. This method allows for a more integrated experience when
            inspecting tools.
          </p>

          <div className='space-y-4'>
            <div>
              <h3 className='font-medium mb-2'>Using Authorization Header:</h3>
              <div className='relative'>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sseEndpoint);
                    toast({
                      title: 'Copied to clipboard',
                      description:
                        'The SSE endpoint has been copied to your clipboard.',
                    });
                  }}
                  className='absolute top-2 right-2 p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors'
                  title='Copy to clipboard'>
                  <Copy className='w-5 h-5' />
                </button>
                <pre className='bg-[#f6f8fa] text-[#24292f] p-4 rounded-md overflow-x-auto'>
                  {sseEndpoint}
                </pre>
              </div>
            </div>

            <div>
              <h3 className='font-medium mb-2'>
                Using URL-based Authentication:
              </h3>
              <div className='relative'>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(urlBasedSseEndpoint);
                    toast({
                      title: 'Copied to clipboard',
                      description:
                        'The URL-based SSE endpoint has been copied to your clipboard.',
                    });
                  }}
                  className='absolute top-2 right-2 p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors'
                  title='Copy to clipboard'>
                  <Copy className='w-5 h-5' />
                </button>
                <pre className='bg-[#f6f8fa] text-[#24292f] p-4 rounded-md overflow-x-auto'>
                  {urlBasedSseEndpoint}
                </pre>
              </div>
            </div>

            <p className='mt-4'>
              Configure your UI to connect to these endpoints and the inspector
              will be triggered automatically, providing real-time tool
              inspection capabilities.
            </p>
          </div>
        </CardContent>
      </Card>

      <h1 className='text-2xl font-semibold'>
        Local Proxy Mode Inspector Guide
      </h1>
      <p className='text-lg'>
        Because MetaMCP is a local proxy and we currently don&apos;t support any
        cloud hosting of your MCPs. You can use MCP&apos;s official inspector to
        check what exact tools you will have access to with MetaMCP.The
        inspector command is used to start the inspector tool. You can use the
        command below to start the inspector tool. In the future we may support
        better experience for you to check inspection details directly on our
        platform.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Terminal className='h-5 w-5' />
            Inspector Command{' '}
            <button
              onClick={() => {
                navigator.clipboard.writeText(inspectorCommand);
                toast({
                  title: 'Copied to clipboard',
                  description:
                    'The inspector command has been copied to your clipboard.',
                });
              }}
              className='p-1 hover:bg-gray-200 rounded-md'>
              <Copy className='h-4 w-4' />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='relative'>
            <pre className='pr-10 whitespace-pre-wrap break-words max-w-[80ch]'>
              {inspectorCommand}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
