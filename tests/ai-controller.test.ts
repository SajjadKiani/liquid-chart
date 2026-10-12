import test from 'node:test';
import assert from 'node:assert/strict';
import { AIWorkspaceController } from '../demo/ai-controller.ts';

test('live candle revisions leave AI research current but invalidate calculation tickets', () => {
  const controller = new AIWorkspaceController();
  const request = controller.beginRequest();
  const calculation = controller.beginCalculation();
  controller.dataChanged();
  assert.equal(controller.isRequestCurrent(request), true);
  assert.equal(controller.isCalculationCurrent(calculation), false);
});

test('data changes invalidate every in-flight indicator calculation', () => {
  const controller = new AIWorkspaceController();
  const first = controller.beginCalculation();
  const second = controller.beginCalculation();
  assert.equal(controller.isCalculationCurrent(first), false);
  assert.equal(controller.isCalculationCurrent(second), true);
  controller.dataChanged();
  assert.equal(controller.isCalculationCurrent(second), false);
});

test('artifact reads and executions are scoped to both current scope and candle revision', () => {
  const controller = new AIWorkspaceController();
  const beforeFileRead = controller.beginImport();
  controller.changeScope();
  assert.equal(controller.isImportCurrent(beforeFileRead), false);
  const beforeExecution = controller.beginImport();
  controller.dataChanged();
  assert.equal(controller.isImportCurrent(beforeExecution), false);
  const firstImport = controller.beginImport();
  const secondImport = controller.beginImport();
  assert.equal(controller.isImportCurrent(firstImport), false);
  assert.equal(controller.isImportCurrent(secondImport), true);
});

test('scope changes invalidate requests without confusing them with live candle updates', () => {
  const controller = new AIWorkspaceController();
  const request = controller.beginRequest();
  controller.dataChanged();
  assert.equal(controller.isRequestCurrent(request), true);
  controller.changeScope();
  assert.equal(controller.isRequestCurrent(request), false);
});

test('request cancellation invalidates results already waiting on local execution', () => {
  const controller = new AIWorkspaceController();
  const request = controller.beginRequest();
  controller.cancelRequest(request);
  assert.equal(controller.isRequestCurrent(request), false);
});
