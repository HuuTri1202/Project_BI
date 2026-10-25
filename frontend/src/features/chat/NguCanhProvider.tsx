import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { HoiDapPanel } from './HoiDapPanel';
import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from './nguCanh';

export function NguCanhProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { pathname } = useLocation();
  const [luu, setLuu] = useState<{ path: string; nguCanh: NguCanh } | null>(null);

  const khai = useCallback((nguCanh: NguCanh): void => {
    setLuu({ path: window.location.pathname, nguCanh });
  }, []);

  const value = useMemo(
    () => ({ nguCanh: luu !== null && luu.path === pathname ? luu.nguCanh : NGU_CANH_RONG, khai }),
    [luu, pathname, khai],
  );

  return (
    <NguCanhContext.Provider value={value}>
      {children}
      <HoiDapPanel />
    </NguCanhContext.Provider>
  );
}
