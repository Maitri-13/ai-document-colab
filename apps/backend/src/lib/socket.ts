import { Server } from 'socket.io'

let io: Server | null = null

export function setIO(server: Server) {
  io = server
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialised')
  return io
}

// Emit to all clients in a document room
export function emitToDocument(documentId: string, event: string, data: unknown) {
  getIO().to(`document:${documentId}`).emit(event, data)
}

// Emit to a single socket
export function emitToSocket(socketId: string, event: string, data: unknown) {
  getIO().to(socketId).emit(event, data)
}
