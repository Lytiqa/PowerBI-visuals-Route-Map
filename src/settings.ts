"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

/**
 * Data Point Formatting Card
 */
export class DataPointCardSettings extends formattingSettings.Card {
    defaultColor = new formattingSettings.ColorPicker({
        name: "defaultColor",
        displayName: "Default color",
        value: { value: "#007ACC" }
    });

    showAllDataPoints = new formattingSettings.ToggleSwitch({
        name: "showAllDataPoints",
        displayName: "Show all",
        value: true
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Fill",
        value: { value: "" }
    });

    name: string = "dataPoint";
    displayName: string = "Data colors";
    slices: Array<formattingSettings.Slice> = [
        this.defaultColor,
        this.showAllDataPoints,
        this.fill
    ];
}

/**
 * Legend Settings Card
 */
export class LegendSettings extends formattingSettings.Card {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    position = new formattingSettings.ItemDropdown({
        name: "position",
        displayName: "Position",
        value: { value: "Top", displayName: "Top" },
        items: [
            { value: "Top", displayName: "Top" },
            { value: "Bottom", displayName: "Bottom" },
            { value: "Left", displayName: "Left" },
            { value: "Right", displayName: "Right" }
        ]
    });

    titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "Title",
        value: "",
        placeholder: "Enter legend title"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text Size",
        value: 8
    });

    showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "Title",
        value: true
    });

    name: string = "legend";
    displayName: string = "Legend";
    slices: Array<formattingSettings.Slice> = [
        this.show,
        this.position,
        this.showTitle,
        this.titleText,
        this.fontSize
    ];
}

/**
 * Route Settings Card
 */
export class RouteSettingsCard extends formattingSettings.Card {
    name: string = "routeSettings";
    displayName: string = "Route Settings";
    slices: Array<formattingSettings.Slice> = [];

    lineWidth = new formattingSettings.NumUpDown({
        name: "lineWidth",
        displayName: "Line Width",
        value: 3
    });

    lineColor = new formattingSettings.ColorPicker({
        name: "lineColor",
        displayName: "Line Color",
        value: { value: "#007ACC" }
    });

    bubbleSize = new formattingSettings.NumUpDown({
        name: "bubbleSize",
        displayName: "Bubble Size",
        value: 3
    });

    useStraightLines = new formattingSettings.ToggleSwitch({
        name: "useStraightLines",
        displayName: "Use Straight Lines",
        value: false
    });

    constructor() {
        super();
        this.slices.push(this.lineWidth);
        this.slices.push(this.lineColor);
        this.slices.push(this.bubbleSize);
        this.slices.push(this.useStraightLines);
    }
}

/**
 * Visual settings model class
 */
export class VisualFormattingSettingsModel extends formattingSettings.Model {
    dataPointCardSettings = new DataPointCardSettings();
    legendSettings = new LegendSettings();
    routeSettingsCard = new RouteSettingsCard();

    cards: formattingSettings.Card[] = [
        this.routeSettingsCard,
        this.legendSettings,
        this.dataPointCardSettings
    ];
}
