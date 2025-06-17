"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { VisualFormattingSettingsModel } from "./settings";
import * as L from "leaflet";
import * as d3 from "d3";
import { legendInterfaces, legend, legendData } from "powerbi-visuals-utils-chartutils";
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;
import ISelectionId = powerbi.visuals.ISelectionId;
import IColorPalette = powerbi.extensibility.IColorPalette;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import IVisualEventService = powerbi.extensibility.IVisualEventService;

interface RouteData {
    origin: string;
    originLat: number;
    originLng: number;
    destination: string;
    destLat: number;
    destLng: number;
    lineWidth: number;
    legendValue: string;
    selectionId?: ISelectionId;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private mapContainer: HTMLElement;
    private map: L.Map;
    private tileLayer: L.TileLayer;
    private width: number = 0;
    private height: number = 0;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private routeGroup: L.LayerGroup;
    private legend: legendInterfaces.ILegend;
    private host: IVisualHost;
    private dataView: DataView;
    private colorPalette: IColorPalette;
    private selectionManager: powerbi.extensibility.ISelectionManager;
    private selectedIds: powerbi.extensibility.ISelectionId[] = [];
    private eventService: IVisualEventService;
    private tooltipServiceWrapper: ITooltipServiceWrapper;
    private isHighContrast: boolean = false;
    private foregroundColor: string = "#000";
    private backgroundColor: string = "#fff";
    private foregroundSelectedColor: string = "#000";
    private hyperlinkColor: string = "#000";

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();
        this.host = options.host;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.eventService = options.host.eventService;
        this.tooltipServiceWrapper = createTooltipServiceWrapper(this.host.tooltipService, this.target);

        this.isHighContrast = this.host.colorPalette.isHighContrast;
        if (this.isHighContrast) {
            this.foregroundColor = this.host.colorPalette.foreground.value;
            this.backgroundColor = this.host.colorPalette.background.value;
            this.foregroundSelectedColor = this.host.colorPalette.foregroundSelected.value;
            this.hyperlinkColor = this.host.colorPalette.hyperlink.value;
        }

        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flex = "1";
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
        this.target.appendChild(wrapper);

        const legendContainer = document.createElement("div");
        legendContainer.className = "legend-container";
        wrapper.appendChild(legendContainer);

        this.mapContainer = document.createElement("div");
        this.mapContainer.className = "route-map";
        wrapper.appendChild(this.mapContainer);

        this.legend = legend.createLegend(legendContainer, true);
        this.initializeMap();
    }

    private initializeMap(): void {
        this.map = L.map(this.mapContainer, {
            zoomControl: true,
            attributionControl: true
        }).setView([0, 0], 2);

        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);

        this.routeGroup = L.layerGroup().addTo(this.map);
    }

    private isValidLatitude(lat: number): boolean {
        return !isNaN(lat) && lat >= -90 && lat <= 90;
    }

    private isValidLongitude(lng: number): boolean {
        return !isNaN(lng) && lng >= -180 && lng <= 180;
    }

    private isValidRouteData(route: RouteData): boolean {
        return this.isValidLatitude(route.originLat) &&
            this.isValidLatitude(route.destLat) &&
            this.isValidLongitude(route.originLng) &&
            this.isValidLongitude(route.destLng);
    }

    private getColumnByRole(
    categorical: powerbi.DataViewCategorical,
    roleName: string
): powerbi.DataViewCategoricalColumn | powerbi.DataViewValueColumn | undefined {
    const category = categorical.categories?.find(cat => cat.source.roles?.[roleName]);
    if (category) return category;

    const value = categorical.values?.find(val => val.source.roles?.[roleName]);
    if (value) return value;

    return undefined;
}

    public update(options: VisualUpdateOptions) {
        if (this.eventService?.renderingStarted) {
            this.eventService.renderingStarted(options);
        }

        try {
            if (!options || !options.dataViews || !options.dataViews[0]) return;
            this.dataView = options.dataViews[0];
            console.log(this.dataView);
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews);
            const categorical = this.dataView.categorical;
            this.width = options.viewport.width;
            this.height = options.viewport.height;
            this.target.style.width = `${this.width}px`;
            this.target.style.height = `${this.height}px`;
            this.map.invalidateSize();

            const originColumn = this.getColumnByRole(categorical, "origin");
            const originLatColumn = this.getColumnByRole(categorical, "originLat");
            const originLngColumn = this.getColumnByRole(categorical, "originLng");
            const destinationColumn = this.getColumnByRole(categorical, "destination");
            const destLatColumn = this.getColumnByRole(categorical, "destLat");
            const destLngColumn = this.getColumnByRole(categorical, "destLng");
            const legendColumn = this.getColumnByRole(categorical, "legend");
            const lineWidthColumn = this.getColumnByRole(categorical, "lineWidth");
            
            const tooltipFields = [
                ...(categorical.values?.filter(v => v.source.roles?.tooltips) || []),
                ...(categorical.categories?.filter(c => c.source.roles?.tooltips) || [])
              ];

            const originValues = originColumn && "values" in originColumn ? originColumn.values : [];
            const originLatValues = originLatColumn && "values" in originLatColumn ? originLatColumn.values : [];
            const originLngValues = originLngColumn && "values" in originLngColumn ? originLngColumn.values : [];
            const destinationValues = destinationColumn && "values" in destinationColumn ? destinationColumn.values : [];
            const destLatValues = destLatColumn && "values" in destLatColumn ? destLatColumn.values : [];
            const destLngValues = destLngColumn && "values" in destLngColumn ? destLngColumn.values : [];
            const legendValues = legendColumn && "values" in legendColumn ? legendColumn.values : [];
            const lineWidthValues = lineWidthColumn && "values" in lineWidthColumn ? lineWidthColumn.values : [];

            const data: RouteData[] = originLatValues.map((_, index) => ({
                origin: originValues[index]?.toString() || '',
                destination: destinationValues[index]?.toString() || '',
                originLat: parseFloat(originLatValues[index] as any),
                originLng: parseFloat(originLngValues[index] as any),
                destLat: parseFloat(destLatValues[index] as any),
                destLng: parseFloat(destLngValues[index] as any),
                lineWidth: lineWidthValues ? parseFloat(lineWidthValues[index] as any) : NaN,
                legendValue: legendValues[index]?.toString() || ''
            })).filter(route => this.isValidRouteData(route));
     
            const showLegend = this.formattingSettings.legendSettings.show.value;
            const legendPositionValue = this.formattingSettings.legendSettings.position.value.value;
            const legendPositionKey = legendInterfaces.LegendPosition[legendPositionValue];
            const defaultColor = this.formattingSettings.routeSettingsCard.lineColor.value.value;
            const legendFontSize = this.formattingSettings.legendSettings.fontSize.value;
            
            this.target.querySelector('.legend-container')?.setAttribute(
                'style',
                `--legend-font-size: ${legendFontSize}px;`
            );

            const selectionIds = legendValues.map((value, index) =>
                this.host.createSelectionIdBuilder()
                    .withCategory(legendColumn as powerbi.DataViewCategoryColumn, index)
                    .createSelectionId()
            );
            
            data.forEach((route, i) => {
                route.selectionId = selectionIds[i];
            });

            const shouldShowLegend = showLegend && !!legendColumn;
            this.updateLegend(data, options.viewport, shouldShowLegend, legendPositionKey, defaultColor);
            this.drawRoutes(data, options.viewport, tooltipFields, categorical);

        } catch (e) {
            console.error("Rendering error:", e);
            if (this.eventService?.renderingFailed) {
                this.eventService.renderingFailed(options, e);
            }
        }

        if (this.eventService?.renderingFinished) {
            this.eventService.renderingFinished(options);
        }
    }

    private updateLegend(
        data: RouteData[],
        viewport: powerbi.IViewport,
        show: boolean,
        position: legendInterfaces.LegendPosition,
        defaultColor: string
    ): void {
        const legendContainer = this.target.querySelector('.legend-container') as HTMLElement;
    
        const legendColumn = this.getColumnByRole(this.dataView.categorical, "legend");
        const legendDisplayName = legendColumn?.source?.displayName ?? "Legend";
        const categories = this.dataView?.categorical?.categories;
    
        const customTitle = this.formattingSettings.legendSettings.titleText.value;
        const showTitle = this.formattingSettings.legendSettings.showTitle.value;
    
        const legendTitle = showTitle
            ? (customTitle?.trim() || legendDisplayName)
            : "";
    
        const uniqueValues = [...new Set(data.map(route => route.legendValue))].sort();
    
        const legendData: legendInterfaces.LegendData = {
            title: legendTitle,
            dataPoints: uniqueValues.map((value, index) => {
                let color = this.isHighContrast ? this.foregroundColor : this.getColorForValue(value) ?? defaultColor;
                
                if (this.isHighContrast && this.selectedIds.some(id => 
                    (id as any).getKey?.() === (this.host.createSelectionIdBuilder()
                        .withCategory(this.dataView.categorical.categories[0], index)
                        .createSelectionId() as any).getKey?.()
                )) {
                    color = this.foregroundSelectedColor;
                }
                
                const selectionId: ISelectionId = this.host.createSelectionIdBuilder()
                    .withCategory(this.dataView.categorical.categories[0], index)
                    .createSelectionId();
    
                return {
                    label: value,
                    color,
                    identity: selectionId,
                    selected: false
                };
            })
        };
    
        const legendPositionKey = position as unknown as keyof typeof legendInterfaces.LegendPosition;
        const legendEnumValue = legendInterfaces.LegendPosition[legendPositionKey];

    
        this.legend.changeOrientation(position as legendInterfaces.LegendPosition);

    
        const mapContainer = this.target.querySelector('.route-map') as HTMLElement;
        const wrapper = this.target.querySelector("div") as HTMLElement;
    
        if (!show) {
            legendContainer.style.display = 'none';
            mapContainer.style.marginLeft = '0';
            this.legend.drawLegend({ dataPoints: [] }, viewport);
            return;
        }
    
        legendContainer.style.display = 'block';
        legendContainer.style.marginLeft = "0";
        legendContainer.style.marginTop = "0";
        mapContainer.style.marginLeft = "0";
        mapContainer.style.marginTop = "0";
    
        if (position === legendInterfaces.LegendPosition.Left) {
            wrapper.style.flexDirection = "row";
            legendContainer.style.order = "0";
            mapContainer.style.order = "1";
            legendContainer.style.minWidth = "150px";
            legendContainer.style.height = "100%";
            mapContainer.style.width = "auto";
            mapContainer.style.height = "100%";
        } else if (position === legendInterfaces.LegendPosition.Right) {
            wrapper.style.flexDirection = "row";
            legendContainer.style.order = "1";
            mapContainer.style.order = "0";
            legendContainer.style.minWidth = "150px";
            legendContainer.style.height = "100%";
            mapContainer.style.width = "auto";
            mapContainer.style.height = "100%";
        } else if (position === legendInterfaces.LegendPosition.Top) {
            wrapper.style.flexDirection = "column";
            legendContainer.style.order = "0";
            mapContainer.style.order = "1";
            legendContainer.style.width = "100%";
            legendContainer.style.minHeight = "50px";
            mapContainer.style.width = "100%";
            mapContainer.style.height = "auto";
        } else if (position === legendInterfaces.LegendPosition.Bottom) {
            wrapper.style.flexDirection = "column";
            legendContainer.style.order = "1";
            mapContainer.style.order = "0";
            legendContainer.style.width = "100%";
            legendContainer.style.minHeight = "50px";
            mapContainer.style.width = "100%";
            mapContainer.style.height = "auto";
        }
        
    
        requestAnimationFrame(() => {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 50);
        });
    
        this.legend.drawLegend(legendData, viewport);
        this.legend.drawLegend(legendData, viewport);
        this.map.invalidateSize();
    }
    

    private getColorForValue(value: string): string {
        if (this.isHighContrast) {
            return this.foregroundColor;
        }
        
        const categories = this.dataView?.categorical?.categories?.[0];
        if (!categories) return this.colorPalette.getColor(value).value;

        const index = categories.values.findIndex(v => v?.toString() === value);
        const object = categories.objects?.[index];
        const colorObj = object?.dataPoint?.fill as powerbi.Fill;
        const userColor = colorObj?.solid?.color;

        return userColor || this.colorPalette.getColor(value).value;
    }

    private drawRoutes(
        data: RouteData[],
        viewport: powerbi.IViewport,
        tooltipFields: (powerbi.DataViewValueColumn | powerbi.DataViewCategoryColumn)[],
        categorical: powerbi.DataViewCategorical
      ): void {
        if (!this.map || !data.length) return;
    
        this.routeGroup.clearLayers();
    
        const lineWidthSetting = this.formattingSettings.routeSettingsCard.lineWidth.value;
        const bubbleSizeSetting = this.formattingSettings.routeSettingsCard.bubbleSize.value;
    
        const validWidths = data.map(d => d.lineWidth).filter(v => !isNaN(v));
        const hasValidWidths = validWidths.length > 0;
        const minWidth = lineWidthSetting;
        const maxWidth = lineWidthSetting * 3;
        const minValue = hasValidWidths ? Math.min(...validWidths) : 0;
        const maxValue = hasValidWidths ? Math.max(...validWidths) : 1;
    
        const bounds = L.latLngBounds([]);
    
        const valueColumns = categorical?.values || [];

        const highlightedColumn = valueColumns.find(col =>
            col.highlights && col.highlights.some(h => h !== null)
        );
        const hasHighlights = !!highlightedColumn;
 

        const originCounts: Record<string, number> = {};
        const destCounts: Record<string, number> = {};
    
        const originMarkers: Record<string, RouteData[]> = {};
        const destMarkers: Record<string, RouteData[]> = {};
    
        data.forEach((route, index) => {
            const originKey = `${route.originLat},${route.originLng}`;
            const destKey = `${route.destLat},${route.destLng}`;
    
            originCounts[originKey] = (originCounts[originKey] || 0) + 1;
            destCounts[destKey] = (destCounts[destKey] || 0) + 1;
    
            originMarkers[originKey] = originMarkers[originKey] || [];
            destMarkers[destKey] = destMarkers[destKey] || [];
    
            originMarkers[originKey].push(route);
            destMarkers[destKey].push(route);        
        });
    
        const getRadius = (count: number, max: number) => {
            const minR = bubbleSizeSetting;
            const maxR = bubbleSizeSetting * 2.5;
            const scale = Math.sqrt(count / max);
            return minR + scale * (maxR - minR);
        };
    
        const maxOrigin = Math.max(...Object.values(originCounts));
        const maxDest = Math.max(...Object.values(destCounts));
    
        data.forEach((route, index) => {
            const range = Math.max(maxValue - minValue, 1e-6);
            const norm = (route.lineWidth - minValue) / range;
            const width = hasValidWidths
                ? minWidth + Math.pow(norm, 0.5) * (maxWidth - minWidth)
                : lineWidthSetting;
            const routeColor = this.getColorForValue(route.legendValue);
            const curvedPath = this.getCurvedPathCoordinates(
                [route.originLat, route.originLng],
                [route.destLat, route.destLng]
            );
    
            const selectionId = (this.host.createSelectionIdBuilder()
                .withCategory(this.dataView.categorical.categories[0], index)
                .createSelectionId()) as ISelectionId;
            const isHighlighted = !hasHighlights || (highlightedColumn?.highlights?.[index] != null);


            const isSelected =
            !hasHighlights && (
                this.selectedIds.length === 0 ||
                this.selectedIds.some(id =>
                    (id as any).getKey?.() === (selectionId as any).getKey?.()
                )
            );

            const opacity = (hasHighlights && !isHighlighted) || (!hasHighlights && !isSelected) ? 0.3 : 1;

            const lineColor = this.isHighContrast 
                ? (isSelected ? this.foregroundSelectedColor : this.foregroundColor) 
                : routeColor;
            
            const fillColor = this.isHighContrast 
                ? (isSelected ? this.foregroundSelectedColor : this.backgroundColor) 
                : routeColor;
            
            const fillOpacity = this.isHighContrast ? 1 : opacity;
    
            const polyline = L.polyline(curvedPath, {
                color: lineColor,
                weight: width,
                opacity: opacity
            }).addTo(this.routeGroup);

            if (tooltipFields.length > 0) {
                const polylineElement = polyline.getElement();
                const d3PolylineSelection = d3.select(polylineElement);
                this.tooltipServiceWrapper.addTooltip(
                    d3PolylineSelection,
                    () => tooltipFields.map(field => ({
                        displayName: field.source.displayName,
                        value: Array.isArray(field.values) ? field.values[index]?.toString() ?? "" : ""
                      })),
                    () => route.selectionId ? route.selectionId.getSelector() : null
                );
            }
            else {
                const polylineElement = polyline.getElement();
                const d3PolylineSelection = d3.select(polylineElement);
                this.tooltipServiceWrapper.addTooltip(
                    d3PolylineSelection,
                    () => [{
                        displayName: "Origin",
                        value: route.origin || `${route.originLat}, ${route.originLng}`
                    }, {
                        displayName: "Destination",
                        value: route.destination || `${route.destLat}, ${route.destLng}`
                    }],
                    () => route.selectionId ? route.selectionId.getSelector() : null
                );
            }
            
            polyline.on("click", (e: any) => {
                const multiSelect = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                this.selectionManager.select(route.selectionId, multiSelect).then(ids => {
                    this.selectedIds = ids;
                    this.drawRoutes(data, viewport, tooltipFields, categorical);
                });
            });
            
            bounds.extend([route.originLat, route.originLng]);
            bounds.extend([route.destLat, route.destLng]);
    
            const originKey = `${route.originLat},${route.originLng}`;
            const destKey = `${route.destLat},${route.destLng}`;
    
            const originRadius = getRadius(originCounts[originKey], maxOrigin);
            const destRadius = getRadius(destCounts[destKey], maxDest);
    
            const originCircle = L.circleMarker([route.originLat, route.originLng], {
                radius: originRadius,
                color: lineColor,
                fillColor: fillColor,
                fillOpacity: fillOpacity,
                weight: 2
            }).addTo(this.routeGroup);
            
            if (tooltipFields.length > 0) {
                const originElement = originCircle.getElement();
                const d3OriginSelection = d3.select(originElement);
                this.tooltipServiceWrapper.addTooltip(
                    d3OriginSelection,
                    () => tooltipFields.map(field => ({
                        displayName: field.source.displayName,
                        value: "values" in field ? field.values[index]?.toString() ?? "" : ""
                    })),
                    () => route.selectionId ? route.selectionId.getSelector() : null
                );
            }else{
            const originElement = originCircle.getElement();
            const d3OriginSelection = d3.select(originElement);
            this.tooltipServiceWrapper.addTooltip(
                d3OriginSelection,
                () => [{
                    displayName: "Origin",
                    value: route.origin || `${route.originLat}, ${route.originLng}`
                }],
                () => route.selectionId ? route.selectionId.getSelector() : null
            );
            }
            
            originCircle.on("click", (e: any) => {
                const lat = route.originLat;
                const lng = route.originLng;
            
                const matchingRoutes = data.filter(r =>
                    r.originLat === lat && r.originLng === lng ||
                    r.destLat === lat && r.destLng === lng
                );
            
                const selectionIds = matchingRoutes.map(r => r.selectionId).filter(id => !!id);
            
                const allSelected = selectionIds.length > 0 && selectionIds.every(sel =>
                    this.selectedIds.some(existing =>
                        (existing as any).getKey?.() === (sel as any).getKey?.()
                    )
                );
            
                if (allSelected) {
                    this.selectionManager.clear().then(() => {
                        this.selectedIds = [];
                        this.drawRoutes(data, viewport, tooltipFields, categorical);
                    });
                } else {
                    const multiSelect = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                    this.selectionManager.select(selectionIds, multiSelect).then(ids => {
                        this.selectedIds = ids;
                        this.drawRoutes(data, viewport, tooltipFields, categorical);
                    });
                }
            });
            
    
            const destCircle = L.circleMarker([route.destLat, route.destLng], {
                radius: destRadius,
                color: lineColor,
                fillColor: fillColor,
                fillOpacity: fillOpacity,
                weight: 2
            }).addTo(this.routeGroup);
    
            if (tooltipFields.length > 0) {
                const destElement = destCircle.getElement();
                const d3DestSelection = d3.select(destElement);
                this.tooltipServiceWrapper.addTooltip(
                    d3DestSelection,
                    () => tooltipFields.map(field => ({
                        displayName: field.source.displayName,
                        value: field.values[index]?.toString() ?? ""
                    })),
                    () => route.selectionId ? route.selectionId.getSelector() : null
                );
            }else{
                const destElement = destCircle.getElement();
                const d3DestSelection = d3.select(destElement);
                this.tooltipServiceWrapper.addTooltip(
                    d3DestSelection,
                    () => [{
                        displayName: "Destination",
                        value: route.destination || `${route.destLat}, ${route.destLng}`
                    }],
                    () => route.selectionId ? route.selectionId.getSelector() : null
                );
            }
    
            destCircle.on("click", (e: any) => {
                const lat = route.destLat;
                const lng = route.destLng;
                const matchingRoutes = data.filter(r =>
                    r.originLat === lat && r.originLng === lng ||
                    r.destLat === lat && r.destLng === lng
                );
            
                const selectionIds = matchingRoutes.map(r => r.selectionId).filter(id => !!id);
            
                const allSelected = selectionIds.length > 0 && selectionIds.every(sel =>
                    this.selectedIds.some(existing =>
                        (existing as any).getKey?.() === (sel as any).getKey?.()
                    )
                );
            
                if (allSelected) {
                    this.selectionManager.clear().then(() => {
                        this.selectedIds = [];
                        this.drawRoutes(data, viewport, tooltipFields, categorical);
                    });
                } else {
                    const multiSelect = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                    this.selectionManager.select(selectionIds, multiSelect).then(ids => {
                        this.selectedIds = ids;
                        this.drawRoutes(data, viewport, tooltipFields, categorical);
                    });
                }
            });
        });
    
        if (bounds.isValid()) {
            this.map.fitBounds(bounds);
        }
    }
    

    private getCurvedPathCoordinates(start: [number, number], end: [number, number]): [number, number][] {
        const latlngs: [number, number][] = [];
        const steps = 100;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const midPoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
            const dist = Math.sqrt(Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2));
            const elevation = dist * 0.15;
            const controlPoint: [number, number] = [midPoint[0] + elevation, midPoint[1]];

            const lat = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * controlPoint[0] + t ** 2 * end[0];
            const lng = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * controlPoint[1] + t ** 2 * end[1];
            latlngs.push([lat, lng]);
        }

        return latlngs;
    }

    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
        const instances: VisualObjectInstance[] = [];

        if (options.objectName === 'dataPoint' && this.dataView?.categorical?.categories) {
            const categories = this.dataView.categorical.categories[0];
            const uniqueValues = [...new Set(categories.values.map(v => v?.toString() || ""))];

            uniqueValues.forEach(value => {
                const valueIndex = categories.values.findIndex(v => v?.toString() === value);
                if (valueIndex === -1) return;

                const color = this.getColorForValue(value);
                const selectionId = this.host.createSelectionIdBuilder()
                    .withCategory(categories, valueIndex)
                    .createSelectionId();

                instances.push({
                    displayName: value,
                    objectName: 'dataPoint',
                    selector: selectionId.getSelector(),
                    properties: {
                        fill: { solid: { color } }
                    }
                });
            });
        }

        if (options.objectName === 'routeSettings') {
            instances.push({
                objectName: 'routeSettings',
                properties: {
                    lineWidth: this.formattingSettings.routeSettingsCard.lineWidth.value,
                    lineColor: this.formattingSettings.routeSettingsCard.lineColor.value,
                    bubbleSize: this.formattingSettings.routeSettingsCard.bubbleSize.value
                },
                selector: null
            });
        }

        if (options.objectName === 'legend') {
            instances.push({
                objectName: 'legend',
                properties: {
                    show: this.formattingSettings.legendSettings.show.value,
                    position: this.formattingSettings.legendSettings.position.value.value,
                    fontSize: this.formattingSettings.legendSettings.fontSize.value,
                    showTitle: this.formattingSettings.legendSettings.showTitle.value,
                    titleText: this.formattingSettings.legendSettings.titleText.value
                },
                selector: null
            });
        }

        return instances;
    }
}