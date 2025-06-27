'use client';

import { useUser } from '@auth0/nextjs-auth0';
import { redirect } from 'next/navigation';
import { Suspense,useEffect } from 'react';

import { Skeleton } from './ui/skeleton';

export default function MetaAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useUser();

  useEffect(() => {
    if (!isLoading && !user) {
      redirect('/auth/login');
    }
  });

  return <Suspense fallback={<Skeleton></Skeleton>}>{children}</Suspense>;
}
