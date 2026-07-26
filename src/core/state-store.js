import {InvariantError} from './errors.js';

export function createStateStore({initialState,reducers={}}){
  if(!initialState||typeof initialState!=='object')throw new InvariantError('State store initialState must be an object.');
  let state=initialState;
  const listeners=new Set(),mutationLog=[];
  return Object.freeze({
    getState:()=>state,
    dispatch(action){
      if(!action||typeof action.type!=='string'||!action.type)throw new InvariantError('Action type is required.');
      const reducer=reducers[action.type];
      if(!reducer)return action;
      const previous=state,next=reducer(previous,action);
      if(next===undefined)throw new InvariantError(`Reducer returned undefined: ${action.type}`);
      state=next;
      mutationLog.push(Object.freeze({type:action.type,payload:action.payload}));
      for(const listener of [...listeners])listener(state,previous,action);
      return action;
    },
    replaceState(nextState,action={type:'state.replaced'}){
      if(!nextState||typeof nextState!=='object')throw new InvariantError('Replacement state must be an object.');
      const previous=state;state=nextState;
      mutationLog.push(Object.freeze({type:action.type,payload:action.payload}));
      for(const listener of [...listeners])listener(state,previous,action);
      return nextState;
    },
    subscribe(listener){
      if(typeof listener!=='function')throw new InvariantError('State listener must be a function.');
      listeners.add(listener);return ()=>listeners.delete(listener);
    },
    mutationLog:()=>mutationLog.slice()
  });
}
