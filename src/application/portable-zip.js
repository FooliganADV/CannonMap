const decoder=new TextDecoder(),encoder=new TextEncoder();
const u16=(bytes,offset)=>bytes[offset]|bytes[offset+1]<<8;
const u32=(bytes,offset)=>(bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;

/** Reads CannonMap's deterministic stored ZIP format without loading media archives. */
export async function readStoredZip(input){
  const bytes=new Uint8Array(input instanceof ArrayBuffer?input:await input.arrayBuffer()),files={};let offset=0;
  while(offset+4<=bytes.length&&u32(bytes,offset)===0x04034b50){
    const method=u16(bytes,offset+8),size=u32(bytes,offset+18),nameLength=u16(bytes,offset+26),extraLength=u16(bytes,offset+28);
    if(method!==0)throw new Error('Compressed finalized packages are not supported by this build.');
    const nameStart=offset+30,dataStart=nameStart+nameLength+extraLength,dataEnd=dataStart+size;if(dataEnd>bytes.length)throw new Error('Finalized package ZIP is truncated.');
    const name=decoder.decode(bytes.slice(nameStart,nameStart+nameLength));if(Object.hasOwn(files,name))throw new Error(`Duplicate ZIP entry: ${name}`);
    files[name]=decoder.decode(bytes.slice(dataStart,dataEnd));offset=dataEnd;
  }
  if(!Object.keys(files).length)throw new Error('Finalized package ZIP contains no readable files.');return files;
}

export const jsonZipFile=(name,value)=>({name,blob:new Blob([typeof value==='string'?value:JSON.stringify(value)],{type:'application/json;charset=utf-8'})});
