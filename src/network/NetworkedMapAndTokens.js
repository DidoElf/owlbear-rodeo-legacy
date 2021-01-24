import React, { useState, useContext, useEffect, useRef } from "react";

import TokenDataContext from "../contexts/TokenDataContext";
import MapDataContext from "../contexts/MapDataContext";
import MapLoadingContext from "../contexts/MapLoadingContext";
import AuthContext from "../contexts/AuthContext";
import DatabaseContext from "../contexts/DatabaseContext";
import PartyContext from "../contexts/PartyContext";

import { omit } from "../helpers/shared";
import useDebounce from "../helpers/useDebounce";
import useNetworkedState from "../helpers/useNetworkedState";
// Load session for auto complete
// eslint-disable-next-line no-unused-vars
import Session from "./Session";

import Map from "../components/map/Map";
import Tokens from "../components/token/Tokens";

/**
 * @typedef {object} NetworkedMapProps
 * @property {Session} session
 */

/**
 * @param {NetworkedMapProps} props
 */
function NetworkedMapAndTokens({ session }) {
  const { userId } = useContext(AuthContext);
  const partyState = useContext(PartyContext);
  const {
    assetLoadStart,
    assetLoadFinish,
    assetProgressUpdate,
    isLoading,
  } = useContext(MapLoadingContext);

  const { putToken, updateToken, getTokenFromDB } = useContext(
    TokenDataContext
  );
  const { putMap, updateMap, getMapFromDB, updateMapState } = useContext(
    MapDataContext
  );

  const [currentMap, setCurrentMap] = useState(null);
  const [currentMapState, setCurrentMapState] = useNetworkedState(
    null,
    session,
    "map_state",
    500,
    true,
    "mapId"
  );
  const [assetManifest, setAssetManifest] = useNetworkedState(
    null,
    session,
    "manifest",
    500,
    false
  );

  async function loadAssetManifestFromMap(map, mapState) {
    const assets = [];
    if (map.type === "file") {
      const { id, lastModified, owner } = map;
      assets.push({ type: "map", id, lastModified, owner });
    }
    let processedTokens = new Set();
    for (let tokenState of Object.values(mapState.tokens)) {
      const token = await getTokenFromDB(tokenState.tokenId);
      if (
        token &&
        token.type === "file" &&
        !processedTokens.has(tokenState.tokenId)
      ) {
        processedTokens.add(tokenState.tokenId);
        // Omit file from token peer will request file if needed
        const { id, lastModified, owner } = token;
        assets.push({ type: "token", id, lastModified, owner });
      }
    }
    setAssetManifest(assets);
  }

  function compareAssets(a, b) {
    return a.type === b.type && a.id === b.id;
  }

  // Return true if an asset is out of date
  function assetNeedsUpdate(oldAsset, newAsset) {
    return (
      compareAssets(oldAsset, newAsset) &&
      oldAsset.lastModified > newAsset.lastModified
    );
  }

  function addAssetIfNeeded(asset) {
    // Asset needs updating
    const exists = assetManifest?.some((oldAsset) =>
      compareAssets(oldAsset, asset)
    );
    const needsUpdate = assetManifest?.some((oldAsset) =>
      assetNeedsUpdate(oldAsset, asset)
    );
    if (!exists || needsUpdate) {
      setAssetManifest((prevAssets) => [
        ...(prevAssets || []).filter(
          (prevAsset) => !compareAssets(prevAsset, asset)
        ),
        asset,
      ]);
    }
  }

  // Keep track of assets we are already requesting to prevent from loading them multiple times
  const requestingAssetsRef = useRef(new Set());

  useEffect(() => {
    if (!assetManifest) {
      return;
    }

    async function requestAssetsIfNeeded() {
      for (let asset of assetManifest) {
        if (
          asset.owner === userId ||
          requestingAssetsRef.current.has(asset.id)
        ) {
          continue;
        }

        const owner = Object.values(partyState).find(
          (player) => player.userId === asset.owner
        );
        if (!owner) {
          continue;
        }

        if (asset.type === "map") {
          const cachedMap = await getMapFromDB(asset.id);
          if (cachedMap && cachedMap.lastModified === asset.lastModified) {
            continue;
          } else if (cachedMap && cachedMap.lastModified > asset.lastModified) {
            // Update last used for cache invalidation
            const lastUsed = Date.now();
            await updateMap(cachedMap.id, { lastUsed });
            setCurrentMap({ ...cachedMap, lastUsed });
          } else {
            requestingAssetsRef.current.add(asset.id);
            session.sendTo(owner.sessionId, "mapRequest", asset.id);
          }
        } else if (asset.type === "token") {
          const cachedToken = await getTokenFromDB(asset.id);
          if (cachedToken && cachedToken.lastModified === asset.lastModified) {
            continue;
          } else if (
            cachedToken &&
            cachedToken.lastModified > asset.lastModified
          ) {
            // Update last used for cache invalidation
            const lastUsed = Date.now();
            await updateToken(cachedToken.id, { lastUsed });
          } else {
            requestingAssetsRef.current.add(asset.id);
            session.sendTo(owner.sessionId, "tokenRequest", asset.id);
          }
        }
      }
    }

    requestAssetsIfNeeded();
  }, [
    assetManifest,
    partyState,
    session,
    getMapFromDB,
    getTokenFromDB,
    updateMap,
    updateToken,
    userId,
  ]);

  /**
   * Map state
   */

  const { database } = useContext(DatabaseContext);
  // Sync the map state to the database after 500ms of inactivity
  const debouncedMapState = useDebounce(currentMapState, 500);
  useEffect(() => {
    if (
      debouncedMapState &&
      debouncedMapState.mapId &&
      currentMap &&
      currentMap.owner === userId &&
      database
    ) {
      updateMapState(debouncedMapState.mapId, debouncedMapState);
    }
  }, [currentMap, debouncedMapState, userId, database, updateMapState]);

  function handleMapChange(newMap, newMapState) {
    // Clear map before sending new one
    setCurrentMap(null);
    session.socket?.emit("map", null);

    setCurrentMapState(newMapState, true, true);
    setCurrentMap(newMap);

    if (newMap && newMap.type === "file") {
      const { file, resolutions, ...rest } = newMap;
      session.socket?.emit("map", rest);
    } else {
      session.socket?.emit("map", newMap);
    }

    if (!newMap || !newMapState) {
      return;
    }

    loadAssetManifestFromMap(newMap, newMapState);
  }

  function handleMapStateChange(newMapState) {
    setCurrentMapState(newMapState, true, true);
  }

  function addMapDrawActions(actions, indexKey, actionsKey) {
    setCurrentMapState((prevMapState) => {
      const newActions = [
        ...prevMapState[actionsKey].slice(0, prevMapState[indexKey] + 1),
        ...actions,
      ];
      const newIndex = newActions.length - 1;
      return {
        ...prevMapState,
        [actionsKey]: newActions,
        [indexKey]: newIndex,
      };
    });
  }

  function updateDrawActionIndex(change, indexKey, actionsKey) {
    const newIndex = Math.min(
      Math.max(currentMapState[indexKey] + change, -1),
      currentMapState[actionsKey].length - 1
    );

    setCurrentMapState((prevMapState) => ({
      ...prevMapState,
      [indexKey]: newIndex,
    }));
    return newIndex;
  }

  function handleMapDraw(action) {
    addMapDrawActions([action], "mapDrawActionIndex", "mapDrawActions");
  }

  function handleMapDrawUndo() {
    updateDrawActionIndex(-1, "mapDrawActionIndex", "mapDrawActions");
  }

  function handleMapDrawRedo() {
    updateDrawActionIndex(1, "mapDrawActionIndex", "mapDrawActions");
  }

  function handleFogDraw(action) {
    addMapDrawActions([action], "fogDrawActionIndex", "fogDrawActions");
  }

  function handleFogDrawUndo() {
    updateDrawActionIndex(-1, "fogDrawActionIndex", "fogDrawActions");
  }

  function handleFogDrawRedo() {
    updateDrawActionIndex(1, "fogDrawActionIndex", "fogDrawActions");
  }

  function handleNoteChange(note) {
    setCurrentMapState((prevMapState) => ({
      ...prevMapState,
      notes: {
        ...prevMapState.notes,
        [note.id]: note,
      },
    }));
  }

  function handleNoteRemove(noteId) {
    setCurrentMapState((prevMapState) => ({
      ...prevMapState,
      notes: omit(prevMapState.notes, [noteId]),
    }));
  }

  /**
   * Token state
   */

  async function handleMapTokenStateCreate(tokenState) {
    if (!currentMap || !currentMapState) {
      return;
    }
    // If file type token send the token to the other peers
    const token = await getTokenFromDB(tokenState.tokenId);
    if (token && token.type === "file") {
      const { id, lastModified, owner } = token;
      addAssetIfNeeded({ type: "token", id, lastModified, owner });
    }
    handleMapTokenStateChange({ [tokenState.id]: tokenState });
  }

  function handleMapTokenStateChange(change) {
    if (!currentMapState) {
      return;
    }
    setCurrentMapState((prevMapState) => ({
      ...prevMapState,
      tokens: {
        ...prevMapState.tokens,
        ...change,
      },
    }));
  }

  function handleMapTokenStateRemove(tokenState) {
    setCurrentMapState((prevMapState) => {
      const { [tokenState.id]: old, ...rest } = prevMapState.tokens;
      return { ...prevMapState, tokens: rest };
    });
  }

  useEffect(() => {
    async function handlePeerData({ id, data, reply }) {
      if (id === "mapRequest") {
        const map = await getMapFromDB(data);
        function replyWithMap(preview, resolution) {
          let response = {
            ...map,
            resolutions: undefined,
            file: undefined,
            // Remove last modified so if there is an error
            // during the map request the cache is invalid
            lastModified: 0,
            // Add last used for cache invalidation
            lastUsed: Date.now(),
          };
          // Send preview if available
          if (map.resolutions[preview]) {
            response.resolutions = { [preview]: map.resolutions[preview] };
            reply("mapResponse", response, "map");
          }
          // Send full map at the desired resolution if available
          if (map.resolutions[resolution]) {
            response.file = map.resolutions[resolution].file;
          } else if (map.file) {
            // The resolution might not exist for other users so send the file instead
            response.file = map.file;
          } else {
            return;
          }
          // Add last modified back to file to set cache as valid
          response.lastModified = map.lastModified;
          reply("mapResponse", response, "map");
        }

        switch (map.quality) {
          case "low":
            replyWithMap(undefined, "low");
            break;
          case "medium":
            replyWithMap("low", "medium");
            break;
          case "high":
            replyWithMap("medium", "high");
            break;
          case "ultra":
            replyWithMap("medium", "ultra");
            break;
          case "original":
            if (map.resolutions) {
              if (map.resolutions.medium) {
                replyWithMap("medium");
              } else if (map.resolutions.low) {
                replyWithMap("low");
              } else {
                replyWithMap();
              }
            } else {
              replyWithMap();
            }
            break;
          default:
            replyWithMap();
        }
      }

      if (id === "mapResponse") {
        const newMap = data;
        if (newMap?.id) {
          setCurrentMap(newMap);
          await putMap(newMap);
          // If we have the final map resolution
          if (newMap.lastModified > 0) {
            requestingAssetsRef.current.delete(newMap.id);
          }
        }
        assetLoadFinish();
      }

      if (id === "tokenRequest") {
        const token = await getTokenFromDB(data);
        // Add a last used property for cache invalidation
        reply("tokenResponse", { ...token, lastUsed: Date.now() }, "token");
      }
      if (id === "tokenResponse") {
        const newToken = data;
        if (newToken?.id) {
          await putToken(newToken);
        }
        assetLoadFinish();
      }
    }

    function handlePeerDataProgress({ id, total, count }) {
      if (count === 1) {
        // Corresponding asset load finished called in token and map response
        assetLoadStart();
      }
      assetProgressUpdate({ id, total, count });
    }

    async function handleSocketMap(map) {
      if (map) {
        if (map.type === "file") {
          const fullMap = await getMapFromDB(map.id);
          setCurrentMap(fullMap || map);
        } else {
          setCurrentMap(map);
        }
      } else {
        setCurrentMap(null);
      }
    }

    session.on("peerData", handlePeerData);
    session.on("peerDataProgress", handlePeerDataProgress);
    session.socket?.on("map", handleSocketMap);

    return () => {
      session.off("peerData", handlePeerData);
      session.off("peerDataProgress", handlePeerDataProgress);
      session.socket?.off("map", handleSocketMap);
    };
  });

  const canChangeMap = !isLoading;

  const canEditMapDrawing =
    currentMap &&
    currentMapState &&
    (currentMapState.editFlags.includes("drawing") ||
      currentMap.owner === userId);

  const canEditFogDrawing =
    currentMap &&
    currentMapState &&
    (currentMapState.editFlags.includes("fog") || currentMap.owner === userId);

  const canEditNotes =
    currentMap &&
    currentMapState &&
    (currentMapState.editFlags.includes("notes") ||
      currentMap.owner === userId);

  const disabledMapTokens = {};
  // If we have a map and state and have the token permission disabled
  // and are not the map owner
  if (
    currentMapState &&
    currentMap &&
    !currentMapState.editFlags.includes("tokens") &&
    currentMap.owner !== userId
  ) {
    for (let token of Object.values(currentMapState.tokens)) {
      if (token.owner !== userId) {
        disabledMapTokens[token.id] = true;
      }
    }
  }

  return (
    <>
      <Map
        map={currentMap}
        mapState={currentMapState}
        onMapTokenStateChange={handleMapTokenStateChange}
        onMapTokenStateRemove={handleMapTokenStateRemove}
        onMapChange={handleMapChange}
        onMapStateChange={handleMapStateChange}
        onMapDraw={handleMapDraw}
        onMapDrawUndo={handleMapDrawUndo}
        onMapDrawRedo={handleMapDrawRedo}
        onFogDraw={handleFogDraw}
        onFogDrawUndo={handleFogDrawUndo}
        onFogDrawRedo={handleFogDrawRedo}
        onMapNoteChange={handleNoteChange}
        onMapNoteRemove={handleNoteRemove}
        allowMapDrawing={canEditMapDrawing}
        allowFogDrawing={canEditFogDrawing}
        allowMapChange={canChangeMap}
        allowNoteEditing={canEditNotes}
        disabledTokens={disabledMapTokens}
        session={session}
      />
      <Tokens onMapTokenStateCreate={handleMapTokenStateCreate} />
    </>
  );
}

export default NetworkedMapAndTokens;
