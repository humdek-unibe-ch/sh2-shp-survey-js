/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

/** The core Data screen showing one data table (the host reads `tableIds`). */
export function dataScreenUrl(dataTableId: number): string {
    return `/admin/data?tableIds=${dataTableId}`;
}
