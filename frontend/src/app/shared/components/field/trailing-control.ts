import { InjectionToken } from '@angular/core';

/**
 * ACC-120 slice 9e — provided by a control that draws something of its own at
 * the inline END of its box (the password input's show/hide button).
 *
 * `am-field` puts its error glyph and its spinner at that same end. A control
 * that provides this token tells the field to move them inward past its own
 * trailing part, so the two never overlap — in either direction, since the
 * field positions them with logical properties.
 *
 * The value is the trailing part's inline size, as a CSS length.
 */
export const FIELD_TRAILING_CONTROL = new InjectionToken<string>('FIELD_TRAILING_CONTROL');
