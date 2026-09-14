import { NextRequest } from 'next/server';
import {
  getRenderProgress,
  touchRenderHeartbeat,
  cancelRenderSession,
} from '@/lib/render-progress';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;
  const renderId = searchParams.get('renderId');
  const action = searchParams.get('action');

  if (!renderId) {
    return new Response(JSON.stringify({ error: 'renderId parameter is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  // Handle instant cancel via GET (e.g. from beacon or simple request)
  if (action === 'cancel') {
    cancelRenderSession(renderId, 'Client requested cancel via GET');
    return new Response(JSON.stringify({ success: true, message: 'Render cancelled' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  // Keep-alive heartbeat: informs watchdog that the client is still connected and waiting
  touchRenderHeartbeat(renderId);

  const progress = getRenderProgress(renderId);

  return new Response(JSON.stringify({ success: true, progress }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;
  const renderId = searchParams.get('renderId');
  const action = searchParams.get('action');

  if (!renderId) {
    return new Response(JSON.stringify({ error: 'renderId parameter is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  // Handle instant cancel via POST (e.g. from navigator.sendBeacon or unload handler)
  if (action === 'cancel') {
    cancelRenderSession(renderId, 'Client requested cancel via POST / unload');
    return new Response(JSON.stringify({ success: true, message: 'Render cancelled' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  return new Response(JSON.stringify({ error: 'Unsupported action' }), {
    status: 400,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
