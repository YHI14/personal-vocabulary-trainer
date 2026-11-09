// A data-only range contract. Native IndexedDB uses its own implementation.
export const keyRange=globalThis.IDBKeyRange||{
 bound:(lower,upper,lowerOpen=false,upperOpen=false)=>({lower,upper,lowerOpen,upperOpen}),
 lowerBound:(lower,lowerOpen=false)=>({lower,lowerOpen}),
 upperBound:(upper,upperOpen=false)=>({upper,upperOpen})
};
