// Hook for reading and toggling bookmarked slash commands in user profile preferences.
import { SlashCommandDescWithSource } from "core";

import { useAppDispatch, useAppSelector } from "../redux/hooks";
import {
  bookmarkSlashCommand,
  selectBookmarkedSlashCommands,
  unbookmarkSlashCommand,
} from "../redux/slices/profilesSlice";

// Provides functions to inspect and toggle bookmark state for slash commands.
export function useBookmarkedSlashCommands() {
  const dispatch = useAppDispatch();
  const bookmarkedCommands = useAppSelector(selectBookmarkedSlashCommands);

  // Checks whether the specified slash command name is currently bookmarked.
  const isCommandBookmarked = (commandName: string): boolean => {
    return bookmarkedCommands.includes(commandName);
  };

  // Toggles the bookmark status of a slash command between saved and unsaved.
  const toggleBookmark = (command: SlashCommandDescWithSource) => {
    const isBookmarked = isCommandBookmarked(command.name);

    if (isBookmarked) {
      dispatch(
        unbookmarkSlashCommand({
          commandName: command.name,
        }),
      );
    } else {
      dispatch(
        bookmarkSlashCommand({
          commandName: command.name,
        }),
      );
    }
  };

  return {
    isCommandBookmarked,
    toggleBookmark,
  };
}
