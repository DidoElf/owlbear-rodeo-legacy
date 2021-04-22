import React, { useState, useRef } from "react";
import { Box, IconButton } from "theme-ui";
import { Stage, Layer, Image } from "react-konva";
import ReactResizeDetector from "react-resize-detector";

import useMapImage from "../../hooks/useMapImage";
import usePreventOverscroll from "../../hooks/usePreventOverscroll";
import useStageInteraction from "../../hooks/useStageInteraction";
import useImageCenter from "../../hooks/useImageCenter";
import useResponsiveLayout from "../../hooks/useResponsiveLayout";

import { getGridDefaultInset, getGridMaxZoom } from "../../helpers/grid";
import KonvaBridge from "../../helpers/KonvaBridge";

import { MapInteractionProvider } from "../../contexts/MapInteractionContext";
import { GridProvider } from "../../contexts/GridContext";

import ResetMapIcon from "../../icons/ResetMapIcon";
import GridOnIcon from "../../icons/GridOnIcon";
import GridOffIcon from "../../icons/GridOffIcon";

import MapGrid from "./MapGrid";
import MapGridEditor from "./MapGridEditor";

function MapEditor({ map, onSettingsChange }) {
  const [mapImage] = useMapImage(map);

  const [stageWidth, setStageWidth] = useState(1);
  const [stageHeight, setStageHeight] = useState(1);
  const [stageScale, setStageScale] = useState(1);

  const defaultInset = getGridDefaultInset(map.grid, map.width, map.height);

  const stageTranslateRef = useRef({ x: 0, y: 0 });
  const mapStageRef = useRef();
  const mapLayerRef = useRef();
  const [preventMapInteraction, setPreventMapInteraction] = useState(false);

  function handleResize(width, height) {
    setStageWidth(width);
    setStageHeight(height);
  }

  const containerRef = useRef();
  usePreventOverscroll(containerRef);

  const [mapWidth, mapHeight] = useImageCenter(
    map,
    mapStageRef,
    stageWidth,
    stageHeight,
    stageTranslateRef,
    setStageScale,
    mapLayerRef,
    containerRef,
    true
  );

  useStageInteraction(
    mapStageRef.current,
    stageScale,
    setStageScale,
    stageTranslateRef,
    mapLayerRef.current,
    getGridMaxZoom(map.grid),
    "move",
    preventMapInteraction
  );

  function handleGridChange(inset) {
    onSettingsChange("grid", {
      ...map.grid,
      inset,
    });
  }

  function handleMapReset() {
    onSettingsChange("grid", {
      ...map.grid,
      inset: defaultInset,
    });
  }

  const [showGridControls, setShowGridControls] = useState(true);

  const mapInteraction = {
    stageScale,
    stageWidth,
    stageHeight,
    setPreventMapInteraction,
    mapWidth,
    mapHeight,
    interactionEmitter: null,
  };

  const canEditGrid = map.type !== "default";

  const gridChanged =
    map.grid.inset.topLeft.x !== defaultInset.topLeft.x ||
    map.grid.inset.topLeft.y !== defaultInset.topLeft.y ||
    map.grid.inset.bottomRight.x !== defaultInset.bottomRight.x ||
    map.grid.inset.bottomRight.y !== defaultInset.bottomRight.y;

  const layout = useResponsiveLayout();

  return (
    <MapInteractionProvider value={mapInteraction}>
      <GridProvider grid={map?.grid} width={mapWidth} height={mapHeight}>
        <Box
          sx={{
            width: "100%",
            height: layout.screenSize === "large" ? "500px" : "300px",
            cursor: "move",
            touchAction: "none",
            outline: "none",
            position: "relative",
          }}
          bg="muted"
          ref={containerRef}
        >
          <ReactResizeDetector handleWidth handleHeight onResize={handleResize}>
            <KonvaBridge
              stageRender={(children) => (
                <Stage
                  width={stageWidth}
                  height={stageHeight}
                  scale={{ x: stageScale, y: stageScale }}
                  ref={mapStageRef}
                >
                  {children}
                </Stage>
              )}
            >
              <Layer ref={mapLayerRef}>
                <Image image={mapImage} width={mapWidth} height={mapHeight} />
                {showGridControls && canEditGrid && (
                  <>
                    <MapGrid map={map} />
                    <MapGridEditor map={map} onGridChange={handleGridChange} />
                  </>
                )}
              </Layer>
            </KonvaBridge>
          </ReactResizeDetector>
          {gridChanged && (
            <IconButton
              title="Reset Grid"
              aria-label="Reset Grid"
              onClick={handleMapReset}
              bg="overlay"
              sx={{
                borderRadius: "50%",
                position: "absolute",
                bottom: 0,
                left: 0,
              }}
              m={2}
            >
              <ResetMapIcon />
            </IconButton>
          )}
          {canEditGrid && (
            <IconButton
              title={
                showGridControls ? "Hide Grid Controls" : "Show Grid Controls"
              }
              aria-label={
                showGridControls ? "Hide Grid Controls" : "Show Grid Controls"
              }
              onClick={() => setShowGridControls(!showGridControls)}
              bg="overlay"
              sx={{
                borderRadius: "50%",
                position: "absolute",
                bottom: 0,
                right: 0,
              }}
              m={2}
              p="6px"
            >
              {showGridControls ? <GridOnIcon /> : <GridOffIcon />}
            </IconButton>
          )}
        </Box>
      </GridProvider>
    </MapInteractionProvider>
  );
}

export default MapEditor;
