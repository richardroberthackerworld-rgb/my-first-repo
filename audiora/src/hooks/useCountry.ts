import { useCallback, useState } from 'react';
import { CURRENCIES, DEFAULT_COUNTRY, currencyFor, type CountryCode } from '@/config/currency';

const KEY = 'audiora:country';

function readStored(): CountryCode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && CURRENCIES.some((c) => c.country === stored)) return stored as CountryCode;
  } catch {
    /* storage disabled */
  }
  return DEFAULT_COUNTRY;
}

/** Selected country + its currency, remembered across visits. */
export function useCountry() {
  const [country, setCountryState] = useState<CountryCode>(readStored);

  const setCountry = useCallback((next: CountryCode) => {
    setCountryState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage disabled */
    }
  }, []);

  return { country, setCountry, currency: currencyFor(country) };
}
