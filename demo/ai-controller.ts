/** Independent lifecycle tickets keep provider research alive during ordinary candle updates. */
export class AIWorkspaceController {
  private scopeRevision = 0;
  private dataRevision = 0;
  private calculationRevision = 0;
  private requestRevision = 0;
  private importRevision = 0;

  changeScope(): void { this.scopeRevision++; this.dataRevision++; this.calculationRevision++; this.requestRevision++; this.importRevision++; }
  dataChanged(): void { this.dataRevision++; this.calculationRevision++; }
  beginRequest() { return { scope: this.scopeRevision, request: ++this.requestRevision }; }
  cancelRequest(ticket: { scope: number; request: number }): void {
    if (this.isRequestCurrent(ticket)) this.requestRevision++;
  }
  isRequestCurrent(ticket: { scope: number; request: number }): boolean {
    return ticket.scope === this.scopeRevision && ticket.request === this.requestRevision;
  }
  beginCalculation() { return { scope: this.scopeRevision, data: this.dataRevision, calculation: ++this.calculationRevision }; }
  isCalculationCurrent(ticket: { scope: number; data: number; calculation: number }): boolean {
    return ticket.scope === this.scopeRevision && ticket.data === this.dataRevision && ticket.calculation === this.calculationRevision;
  }
  beginImport() { return { scope: this.scopeRevision, data: this.dataRevision, import: ++this.importRevision }; }
  isImportCurrent(ticket: { scope: number; data: number; import: number }): boolean {
    return ticket.scope === this.scopeRevision && ticket.data === this.dataRevision && ticket.import === this.importRevision;
  }
  beginDatasetCheck() { return { scope: this.scopeRevision, data: this.dataRevision }; }
  isDatasetCurrent(ticket: { scope: number; data: number }): boolean {
    return ticket.scope === this.scopeRevision && ticket.data === this.dataRevision;
  }
  get scope() { return this.scopeRevision; }
}
