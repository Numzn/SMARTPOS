import { apiFetch } from '../lib/apiClient';

export async function fetchPrinters() {
  return apiFetch('/settings/printers');
}

export async function fetchPrinterStatus() {
  return apiFetch('/settings/printers/status');
}

export async function createPrinter(data) {
  return apiFetch('/settings/printers', { method: 'POST', body: data });
}

export async function updatePrinter(id, data) {
  return apiFetch(`/settings/printers/${id}`, { method: 'PATCH', body: data });
}

export async function deletePrinter(id) {
  return apiFetch(`/settings/printers/${id}`, { method: 'DELETE' });
}

export async function testPrinter(id) {
  return apiFetch(`/settings/printers/${id}/test`, { method: 'POST' });
}

export async function printReceiptEscPos(viewModel, printerId) {
  return apiFetch('/settings/printers/receipt', {
    method: 'POST',
    body: { viewModel, printerId },
  });
}
