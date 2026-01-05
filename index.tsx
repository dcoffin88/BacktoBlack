import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global number formatting: default to 2 decimal places when no precision is specified
const originalToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions
) {
  const opts =
    options && typeof options === 'object'
      ? { ...options }
      : {};
  const minSet = opts.minimumFractionDigits !== undefined;
  const maxSet = opts.maximumFractionDigits !== undefined;

  if (!minSet && !maxSet) {
    opts.minimumFractionDigits = 2;
    opts.maximumFractionDigits = 2;
  } else if (minSet && !maxSet) {
    opts.maximumFractionDigits = opts.minimumFractionDigits;
  } else if (minSet && maxSet && (opts.maximumFractionDigits as number) < (opts.minimumFractionDigits as number)) {
    // Prevent RangeError when the supplied max is below the supplied min.
    opts.maximumFractionDigits = opts.minimumFractionDigits;
  }
  return originalToLocaleString.call(this, locales as any, opts);
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
