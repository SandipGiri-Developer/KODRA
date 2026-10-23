// Hook maintaining a mutable React ref synchronously updated whenever value dependencies change.
import { useEffect, useRef } from "react";

// Returns a persistent ref holding the freshest reference to the provided value.
function useUpdatingRef<T>(value: T, deps: any[] = []) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value, ...deps]);

  return ref;
}

export default useUpdatingRef;
