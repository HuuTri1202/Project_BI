import type { ChartType, ExplorerFieldsDto, ReportDataDto } from '@bi/shared';
import { createContext, useContext, useEffect } from 'react';

import type { SuaBieuDo } from './goiYBieuDo';

export interface DuKien {
  nhan: string;
  gia: string;
  luuY?: string;
}

export interface BangTho {
  cot: string[];
  dong: (string | number | boolean | null)[][];
  luuY: string;
}

export interface Nguon {
  ten: string;
  duKien: DuKien[];
  bang?: ReportDataDto;
  bangTho?: BangTho;
  moHinhId?: number;
}

export interface NguCanh {
  trang: string;
  nguon: Nguon[];
  moHinhId?: number;
  truong?: ExplorerFieldsDto;
  veBieuDo?: (g: { chieuId: number; thuocDoId: number; loai: ChartType }) => void;
  suaBieuDo?: (thay: SuaBieuDo) => void;
  chieuPhu?: string | null;
}

export const NGU_CANH_RONG: NguCanh = { trang: '', nguon: [] };

export const NguCanhContext = createContext<{
  nguCanh: NguCanh;
  khai: (nguCanh: NguCanh) => void;
}>({ nguCanh: NGU_CANH_RONG, khai: () => undefined });

export function useKhaiNguCanh(nguCanh: NguCanh): void {
  const { khai } = useContext(NguCanhContext);
  useEffect(() => {
    khai(nguCanh);
  }, [khai, nguCanh]);
}

export function useNguCanh(): NguCanh {
  return useContext(NguCanhContext).nguCanh;
}
