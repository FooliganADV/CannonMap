export class CannonMapError extends Error {
  constructor(message,{code='CANNONMAP_ERROR',cause,details}={}){
    super(message,{cause});
    this.name=new.target.name;
    this.code=code;
    this.details=details;
  }
}

export class InvariantError extends CannonMapError {
  constructor(message,options={}){
    super(message,{...options,code:options.code??'INVARIANT_VIOLATION'});
  }
}
