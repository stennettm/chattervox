import * as AX25 from 'ax25' // https://github.com/echicken/node-ax25/tree/es6rewrite
import { compress, decompress } from './compression.js'

export enum HeaderFlags {
    Compressed = 0x01,
    Signed = 0x2
}

export const MagicBytes = [0x7a, 0x39]

export interface Header {
    version: number,
    compressed: boolean,
    signed: boolean,
    signatureLength: number
}

export class Packet {

    header: Header
    from: string
    to: string
    message: string
    signature: Buffer
    data: Buffer

    constructor() {
        
        this.header = {
            version: 0x01,
            compressed: null,
            signed: null,
            signatureLength: null
        }

        this.from = null
        this.to = null
        this.message = null
        this.signature = null
        this.data = null
    }

    async toAX25Packet(): Promise<any> {
        const packet = new AX25.Packet()
        packet.type = AX25.Masks.control.frame_types.u_frame.subtypes.ui
        packet.source = { callsign : this.from, ssid : 0 }
        packet.destination = { callsign : this.to, ssid : 0 }
        packet.payload = await this.assemble()
        return packet.assemble()
    }

    async assemble(): Promise<Buffer> {
        
        // compress signature + message
        let payload = Buffer.from([])
        if (this.signature) payload = this.signature
        payload = Buffer.concat([payload, Buffer.from(this.message, 'utf8')])
        const compressed = await compress(payload)

        if (compressed.length < payload.length) {
            this.header.compressed = true
            payload = compressed
        } else {
            this.header.compressed = false
        }

        // flags
        let flags = 0x00
        if (Buffer.isBuffer(this.signature)) flags = flags | HeaderFlags.Signed
        if (this.header.compressed) flags = flags | HeaderFlags.Compressed
        
        // header buffer
        const headerArray = [...MagicBytes, this.header.version, flags]
        if (this.signature !== null) {
            if (this.signature.length > 256) throw Error('signature is larger than 256 bytes')
            headerArray.push(this.signature.length)
        }

        const header = Buffer.from(new Uint8Array(headerArray))
        this.data = Buffer.concat([header, payload])
        return this.data
    }

    async disassemble(data: Buffer): Promise<void> {

        if (!Buffer.isBuffer(data)) throw TypeError('data must be a Buffer')

        const magic = data.slice(0, 2)
        if (magic[0] !== MagicBytes[0] || magic[1] !== MagicBytes[1]) {
            throw Error(`Invalid magic bytes in packet header. This is not a CV Packet.`)
        }

        const version = data[2]
        if (version !== 1) {
            throw Error(`Invalid packet version: ${version}`)
        }

        // COME BACK HERE
        const flags = data[3]
        this.header.compressed = (flags & HeaderFlags.Compressed) == HeaderFlags.Compressed
        this.header.signed = (flags & HeaderFlags.Signed) == HeaderFlags.Signed

        // console.log(`compressed: ${this.header.compressed}`)
        // console.log(`signed: ${this.header.signed}`)

        let payloadIndex = 4
        if (this.header.signed) {
            this.header.signatureLength = data[4]
            payloadIndex = 5
        }

        let payload: Buffer = data.slice(payloadIndex)
        if (this.header.compressed) {
            payload = await decompress(payload)
        }

        let messageIndex = 0
        if (this.header.signed) {
            this.signature = payload.slice(0, this.header.signatureLength)
            messageIndex = this.header.signatureLength
            // console.log(`data length: ${data.length}`)
            // console.log(`signature length: ${this.header.signatureLength}`)
            // console.log(`payload length: ${payload.length}`)
        }


        this.message = payload.slice(messageIndex).toString('utf8')
    }

    static async ToAX25Packet(fromCallsign: string, 
                              toCallsign: string, 
                              utf8Text: string, 
                              signature?: Buffer): Promise<any> {
        
        const packet = new Packet()
        packet.from = fromCallsign
        packet.to = toCallsign
        packet.message = utf8Text
        
        if (signature) {
            if (Buffer.isBuffer(signature)) packet.signature = signature
            else throw TypeError(`signature must be a Buffer type, not ${typeof signature}`)
        }

        if (packet.signature) {
            packet.header.signatureLength = packet.signature.length
        }

        return await packet.toAX25Packet()
    }

    static async FromAX25Packet(ax25Buffer: Buffer): Promise<Packet> {
        const ax25Packet = new AX25.Packet()
        ax25Packet.disassemble(ax25Buffer)

        if (ax25Packet.payload.length == 0) {
            throw Error('ax25 packet payload is empty')
        }

        const packet = new Packet()
        packet.from = ax25Packet.source.callsign.trim()
        packet.to = ax25Packet.destination.callsign.trim()
        await packet.disassemble(ax25Packet.payload)
        return packet
    }
}
