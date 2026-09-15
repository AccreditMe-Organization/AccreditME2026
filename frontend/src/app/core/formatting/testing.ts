import { EnvironmentProviders, Provider } from '@angular/core';
import { FormatContext, TestFormatContext } from './format-context';

// Specs set the tenant zone and the calendar directly, and switch language the
// way the app does (TranslateService.use). Inject TestFormatContext to change
// either mid-test:
//
//   TestBed.inject(TestFormatContext).zone.set('America/New_York');
export function provideFormatTesting(): (Provider | EnvironmentProviders)[] {
  return [TestFormatContext, { provide: FormatContext, useExisting: TestFormatContext }];
}
