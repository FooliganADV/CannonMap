import {createLayerRegistry} from './layer-registry.js';

export const MAP_LAYER_TYPES=Object.freeze(['features','competitors','stationaryEvents','traffic','weather','radar']);

export function createMapEngine({
  L,
  container,
  initialCenter=[38.5,-98.5],
  initialZoom=4,
  preferredBaseLayer='Streets',
  onBaseLayerChange=()=>{}
}={}){
  if(!L?.map||!container)throw new TypeError('Leaflet and a map container are required.');
  const map=L.map(container,{zoomControl:true,preferCanvas:true}).setView(initialCenter,initialZoom);
  const baseLayers={
    Streets:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}),
    Topographic:L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenStreetMap contributors, SRTM · OpenTopoMap'}),
    Satellite:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}),
    CyclOSM:L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors · CyclOSM'}),
    'USGS Topo':L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,attribution:'USGS The National Map'})
  };
  (baseLayers[preferredBaseLayer]||baseLayers.Streets).addTo(map);

  const layers=createLayerRegistry({map,L,layerTypes:MAP_LAYER_TYPES});
  L.control.layers(baseLayers,{
    'Competitor trails':layers.group('competitors'),
    'Stationary events':layers.group('stationaryEvents'),
    'Traffic incidents':layers.group('traffic'),
    Weather:layers.group('weather'),
    'Weather radar':layers.group('radar')
  },{position:'topright',collapsed:true}).addTo(map);
  map.on('baselayerchange',event=>onBaseLayerChange(event.name));

  return Object.freeze({
    map,
    baseLayers:Object.freeze(baseLayers),
    layers,
    group:type=>layers.group(type),
    fitLayerType(type,options={padding:[25,25]}){
      const group=layers.group(type);
      const bounds=group.getBounds();
      if(bounds.isValid())map.fitBounds(bounds,options);
      return bounds.isValid();
    },
    fitLayerTypes(types,options={padding:[30,30],maxZoom:14}){
      const bounds=L.latLngBounds([]);
      for(const type of types){
        layers.group(type).eachLayer(layer=>{
          if(layer.getBounds)bounds.extend(layer.getBounds());
          else if(layer.getLatLng)bounds.extend(layer.getLatLng());
        });
      }
      if(bounds.isValid())map.fitBounds(bounds,options);
      return bounds.isValid();
    },
    destroy(){
      layers.destroy();
      map.remove();
    }
  });
}
