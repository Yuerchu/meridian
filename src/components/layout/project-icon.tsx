import './project-icon.css'
import { FolderOpen, User, Users } from '@keyline-icons/react/two-tone'

/** A project is either a directory on disk or an archived external channel conversation. */
export function ProjectIcon({ sourceType }: { sourceType: string }) {
  switch (sourceType) {
    case 'channel_direct':
      return <User className="m-project-icon" />
    case 'channel_group':
      return <Users className="m-project-icon" />
    default:
      return <FolderOpen className="m-project-icon" />
  }
}
