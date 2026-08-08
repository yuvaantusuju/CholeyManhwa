import { FormEvent, RefObject, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, LoaderCircle, Search, X } from 'lucide-react';

export type SearchResult = {
  title: string;
  url: string;
  cover: string | null;
  latestChapter: string | null;
};

type Props = {
  value: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSelect: (result: SearchResult) => void;
  onSubmit: (event: FormEvent) => void;
};

const isUrl = (value: string) => /^https?:\/\//i.test(value.trim());

export default function SeriesSearch({ value, inputRef, disabled, onValueChange, onSelect, onSubmit }: Props) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2 || isUrl(query)) {
      requestRef.current?.abort();
      setResults([]);
      setSearchError('');
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setSearching(true);
      setSearchError('');
      try {
        const response = await fetch(`/api/search?${new URLSearchParams({ q: query })}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Search is unavailable.');
        setResults(data.results || []);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : 'Search is unavailable.');
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (result: SearchResult) => {
    setOpen(false);
    setResults([]);
    onSelect(result);
  };

  return (
    <form className="series-search-form" onSubmit={onSubmit}>
      <div className="series-search-root" ref={rootRef}>
        <div className="url-input-wrap">
          <Search size={20} />
          <input
            ref={inputRef}
            value={value}
            onFocus={() => results.length && setOpen(true)}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Search  by title."
            aria-label="Search manga or manhwa title."
            autoComplete="off"
            disabled={disabled}
          />
          {value && !disabled && <button type="button" aria-label="Clear search" className="clear-input" onClick={() => { onValueChange(''); setResults([]); }}><X size={16} /></button>}
        </div>
        {open && !isUrl(value) && (
          <div className="search-results" role="listbox" aria-label="Search results">
            <div className="search-results-head"><span>Search results</span></div>
            {searchError ? <div className="search-message"><strong>Search unavailable</strong><span>{searchError}</span><small>Enter the correct series title to search.</small></div>
              : results.length ? results.map((result) => (
                <button type="button" role="option" key={result.url} onClick={() => choose(result)}>
                  {result.cover ? <img src={`/api/proxy-image?${new URLSearchParams({ url: result.cover, referer: result.url })}`} alt="" /> : <span className="result-cover"><BookOpen size={17} /></span>}
                  <span><strong>{result.title}</strong><small>{result.latestChapter || 'Open full chapter list'}</small></span>
                  <ArrowRight size={15} />
                </button>
              )) : !searching && <div className="search-message"><strong>No matching titles</strong><span>Try another spelling.</span></div>}
          </div>
        )}
      </div>
      <button className="analyze-button" disabled={disabled || !isUrl(value)}>Load series <ArrowRight size={18} /></button>
    </form>
  );
}
